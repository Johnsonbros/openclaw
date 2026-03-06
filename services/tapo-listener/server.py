#!/usr/bin/env python3
"""ZEKE Tapo Camera Listener -- wake word detection + conversation via camera."""

import asyncio
import logging
import os
import time
from pathlib import Path

import httpx
import yaml
from fastapi import FastAPI
from pydantic import BaseModel

from audio_processing import has_energy, transcribe
from gateway_client import GatewayClient
from rtsp_audio import RtspAudioCapture
from wake_detector import WakeDetector

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("tapo-listener")

# --- Config ---

def load_config() -> dict:
    config_paths = [
        Path(os.environ.get("TAPO_LISTENER_CONFIG", "")),
        Path.home() / ".openclaw" / "tapo-listener.yaml",
        Path(__file__).parent / "config.yaml",
    ]
    for p in config_paths:
        if p.is_file():
            log.info("Loading config from %s", p)
            return yaml.safe_load(p.read_text())
    raise RuntimeError("No config file found. Create ~/.openclaw/tapo-listener.yaml")


CONFIG = load_config()
CAM = CONFIG["camera"]
WHISPER_URL = CONFIG.get("whisper", {}).get("url", "http://localhost:8778")
GW_URL = CONFIG.get("gateway", {}).get("url", "ws://127.0.0.1:18789")
GW_TOKEN = CONFIG["gateway"]["token"]
GW_SESSION = CONFIG.get("gateway", {}).get("session_key", "main")
PTZ_URL = CONFIG.get("ptz", {}).get("url", "http://localhost:18791")
SERVICE_PORT = CONFIG.get("service", {}).get("port", 18792)
ENERGY_THRESHOLD = CONFIG.get("service", {}).get("energy_threshold", 200)
CONVERSATION_TIMEOUT = CONFIG.get("service", {}).get("conversation_timeout", 30)
WAKE_WORDS = CONFIG.get("service", {}).get("wake_words", ["zeke"])

# --- State ---

app = FastAPI(title="ZEKE Tapo Listener")
_rtsp: RtspAudioCapture | None = None
_gateway: GatewayClient | None = None
_wake: WakeDetector | None = None
_listening = False
_listen_task: asyncio.Task | None = None
_last_wake: float = 0
_wake_cooldown = 5.0  # seconds between wake events


# --- PTZ helpers ---

async def ptz_gesture(gesture: str):
    """Trigger a PTZ gesture via the PTZ service."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.post(
                f"{PTZ_URL}/express",
                json={"gesture": gesture},
            )
            if resp.status_code == 200:
                log.info("PTZ gesture: %s", gesture)
            else:
                log.warning("PTZ gesture failed: %d %s", resp.status_code, resp.text)
    except Exception as e:
        log.warning("PTZ service unreachable: %s", e)


# --- Main listen loop ---

async def listen_loop():
    """Main loop: read RTSP audio, transcribe, detect wake, send to ZEKE."""
    global _last_wake, _listening

    _listening = True

    # Connect to gateway
    try:
        await _gateway.connect()
    except Exception as e:
        log.error("Gateway connect failed: %s", e)
        _listening = False
        return

    # Start RTSP capture
    try:
        await _rtsp.start()
    except Exception as e:
        log.error("RTSP start failed: %s", e)
        _listening = False
        return

    log.info("Listening for 'Hey ZEKE'...")

    # Accumulate multiple 1s chunks before transcribing (reduces Whisper calls)
    buffer = bytearray()
    BUFFER_CHUNKS = 3  # transcribe every 3 seconds
    chunk_count = 0

    while _listening and _rtsp.running:
        try:
            chunk = await _rtsp.read_chunk()
            if chunk is None:
                log.warning("RTSP stream ended, reconnecting in 5s...")
                await asyncio.sleep(5)
                try:
                    await _rtsp.stop()
                    await _rtsp.start()
                except Exception as e:
                    log.error("RTSP reconnect failed: %s", e)
                    await asyncio.sleep(10)
                continue

            # Energy gate on each chunk
            if not has_energy(chunk, ENERGY_THRESHOLD):
                # Silence -- if we have buffered audio, flush it
                if buffer:
                    await _process_buffer(bytes(buffer))
                    buffer.clear()
                    chunk_count = 0
                else:
                    # Check for conversation timeout on silence
                    result = _wake.process_transcript("")
                    if result and result["action"] == "end_conversation":
                        await ptz_gesture("rest")
                continue

            buffer.extend(chunk)
            chunk_count += 1

            # Transcribe after accumulating enough chunks
            if chunk_count >= BUFFER_CHUNKS:
                await _process_buffer(bytes(buffer))
                buffer.clear()
                chunk_count = 0

        except asyncio.CancelledError:
            break
        except Exception as e:
            log.error("Listen loop error: %s", e)
            await asyncio.sleep(1)

    _listening = False
    log.info("Listen loop stopped")


async def _process_buffer(pcm: bytes):
    """Transcribe a PCM buffer and process through wake detector."""
    global _last_wake

    text = await transcribe(pcm, WHISPER_URL)
    if not text:
        return

    log.debug("Transcript: %s", text[:100])

    result = _wake.process_transcript(text)
    if not result:
        return

    action = result["action"]
    now = time.monotonic()

    if action == "wake":
        # Rate limit wake events
        if now - _last_wake < _wake_cooldown:
            log.debug("Wake cooldown, skipping")
            return
        _last_wake = now

        # PTZ: greet + look for person
        await ptz_gesture("greet")

        # Send to ZEKE with camera mic provenance
        message = f"[CAMERA MIC] {result['text']}"
        await _gateway.send_chat(message)

    elif action == "message":
        # Conversation follow-up
        message = f"[CAMERA MIC] {result['text']}"
        await _gateway.send_chat(message)

    elif action == "end_conversation":
        await ptz_gesture("rest")


# --- FastAPI endpoints ---

@app.get("/health")
async def health():
    return {
        "ok": True,
        "service": "tapo-listener",
        "listening": _listening,
        "rtsp_connected": _rtsp.running if _rtsp else False,
        "gateway_connected": _gateway.connected if _gateway else False,
    }


@app.get("/status")
async def status():
    return {
        "ok": True,
        "listening": _listening,
        "rtsp_connected": _rtsp.running if _rtsp else False,
        "gateway_connected": _gateway.connected if _gateway else False,
        "whisper_url": WHISPER_URL,
        "conversation_mode": _wake.in_conversation if _wake else False,
        "conversation_state": _wake.state if _wake else "none",
        "last_wake": _last_wake,
    }


class WakeRequest(BaseModel):
    text: str = "Hey ZEKE"


@app.post("/wake")
async def force_wake(req: WakeRequest):
    """Force a wake event for testing."""
    if not _gateway or not _gateway.connected:
        return {"ok": False, "error": "Not connected to gateway"}
    await ptz_gesture("greet")
    message = f"[CAMERA MIC] {req.text}"
    result = await _gateway.send_chat(message)
    return {"ok": True, "sent": message, "result": result}


@app.post("/stop")
async def stop_listening():
    global _listening, _listen_task
    _listening = False
    if _listen_task:
        _listen_task.cancel()
        _listen_task = None
    if _rtsp:
        await _rtsp.stop()
    return {"ok": True, "listening": False}


@app.post("/start")
async def start_listening():
    global _listen_task
    if _listening:
        return {"ok": True, "listening": True, "message": "Already listening"}
    _listen_task = asyncio.create_task(listen_loop())
    return {"ok": True, "listening": True}


# --- Startup ---

@app.on_event("startup")
async def on_startup():
    global _rtsp, _gateway, _wake, _listen_task

    _rtsp = RtspAudioCapture(
        host=CAM["host"],
        user=CAM["user"],
        password=CAM["password"],
        port=CAM.get("rtsp_port", 554),
        stream=CAM.get("stream", "stream1"),
    )

    _gateway = GatewayClient(
        url=GW_URL,
        token=GW_TOKEN,
        session_key=GW_SESSION,
    )

    _wake = WakeDetector(
        wake_words=WAKE_WORDS,
        conversation_timeout=CONVERSATION_TIMEOUT,
    )

    # Auto-start listening
    _listen_task = asyncio.create_task(listen_loop())


@app.on_event("shutdown")
async def on_shutdown():
    global _listening
    _listening = False
    if _rtsp:
        await _rtsp.stop()
    if _gateway:
        await _gateway.close()


# --- Main ---

if __name__ == "__main__":
    import uvicorn
    log.info("Starting Tapo Listener on port %d", SERVICE_PORT)
    uvicorn.run(app, host="127.0.0.1", port=SERVICE_PORT, log_level="info")
