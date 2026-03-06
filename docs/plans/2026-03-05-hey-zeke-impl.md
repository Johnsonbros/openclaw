# "Hey ZEKE" Tapo Camera Listener — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A Python service that pulls audio from the Tapo C260 camera via RTSP, transcribes it with Whisper, wakes ZEKE on "Hey ZEKE", tracks the person via PTZ, and plays TTS responses back.

**Architecture:** Python FastAPI sidecar (`services/tapo-listener/`) running on the Mac. Uses `ffmpeg` for RTSP audio extraction, posts PCM to existing Whisper server, sends transcripts to gateway via WebSocket, triggers PTZ gestures, and plays TTS via Mac speakers (camera speaker backchannel added later).

**Tech Stack:** Python 3, ffmpeg, fastapi, uvicorn, websockets, numpy, pytapo, pyyaml

---

### Task 1: RTSP Audio Capture Module

**Files:**
- Create: `services/tapo-listener/rtsp_audio.py`

**Step 1: Write the module**

This module spawns an `ffmpeg` subprocess that pulls the Tapo's RTSP stream and outputs raw PCM to stdout. The caller reads 1-second chunks.

```python
"""RTSP audio capture via ffmpeg subprocess."""

import asyncio
import logging
import shutil

log = logging.getLogger("tapo-listener.rtsp")

CHUNK_DURATION_S = 1
SAMPLE_RATE = 16000
SAMPLE_WIDTH = 2  # 16-bit
CHANNELS = 1
CHUNK_BYTES = SAMPLE_RATE * SAMPLE_WIDTH * CHANNELS * CHUNK_DURATION_S  # 32000


class RtspAudioCapture:
    def __init__(self, host: str, user: str, password: str, port: int = 554, stream: str = "stream1"):
        self._rtsp_url = f"rtsp://{user}:{password}@{host}:{port}/{stream}"
        self._process: asyncio.subprocess.Process | None = None
        self._running = False

    async def start(self):
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            raise RuntimeError("ffmpeg not found on PATH")

        self._running = True
        self._process = await asyncio.create_subprocess_exec(
            ffmpeg,
            "-hide_banner", "-loglevel", "error",
            "-rtsp_transport", "tcp",
            "-i", self._rtsp_url,
            "-vn",                          # no video
            "-acodec", "pcm_s16le",         # 16-bit PCM
            "-ar", str(SAMPLE_RATE),        # 16kHz
            "-ac", str(CHANNELS),           # mono
            "-f", "s16le",                  # raw PCM output
            "pipe:1",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        log.info("RTSP audio capture started: %s", self._rtsp_url.split("@")[-1])

    async def read_chunk(self) -> bytes | None:
        """Read one second of PCM audio. Returns None if stream ended."""
        if not self._process or not self._process.stdout:
            return None
        try:
            data = await self._process.stdout.readexactly(CHUNK_BYTES)
            return data
        except (asyncio.IncompleteReadError, ConnectionError):
            log.warning("RTSP stream ended or interrupted")
            return None

    async def stop(self):
        self._running = False
        if self._process:
            self._process.terminate()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=5)
            except asyncio.TimeoutError:
                self._process.kill()
            self._process = None
            log.info("RTSP audio capture stopped")

    @property
    def running(self) -> bool:
        return self._running and self._process is not None and self._process.returncode is None
```

**Step 2: Test manually**

```bash
cd services/tapo-listener
python3 -c "
import asyncio
from rtsp_audio import RtspAudioCapture
async def test():
    cap = RtspAudioCapture('TAPO_IP', 'admin', 'PASS')
    await cap.start()
    chunk = await cap.read_chunk()
    print(f'Got {len(chunk)} bytes' if chunk else 'No data')
    await cap.stop()
asyncio.run(test())
"
```

**Step 3: Commit**

```bash
git add services/tapo-listener/rtsp_audio.py
git commit -m "feat(tapo-listener): add RTSP audio capture module"
```

---

### Task 2: Audio Energy Gate + Whisper Client

**Files:**
- Create: `services/tapo-listener/audio_processing.py`

**Step 1: Write the module**

Mirrors the gateway's `AudioInputProcessor` logic: energy gate (RMS threshold) and Whisper HTTP client.

```python
"""Audio energy detection and Whisper transcription client."""

import logging
import struct
import math

import httpx
import numpy as np

log = logging.getLogger("tapo-listener.audio")


def compute_rms(pcm: bytes) -> float:
    """Compute RMS energy of 16-bit signed PCM."""
    sample_count = len(pcm) // 2
    if sample_count == 0:
        return 0.0
    samples = np.frombuffer(pcm, dtype=np.int16)
    return float(np.sqrt(np.mean(samples.astype(np.float64) ** 2)))


def has_energy(pcm: bytes, threshold: float = 200.0) -> bool:
    """Return True if audio has energy above silence threshold."""
    return compute_rms(pcm) > threshold


async def transcribe(pcm: bytes, whisper_url: str = "http://localhost:8778") -> str | None:
    """Send raw PCM to Whisper server, return transcript or None."""
    if len(pcm) < 32:
        return None
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{whisper_url}/transcribe",
                content=pcm,
                headers={"Content-Type": "application/octet-stream"},
            )
            if resp.status_code != 200:
                log.warning("Whisper HTTP %d", resp.status_code)
                return None
            data = resp.json()
            text = data.get("text", "").strip()
            return text if text else None
    except Exception as e:
        log.warning("Whisper request failed: %s", e)
        return None
```

**Step 2: Commit**

```bash
git add services/tapo-listener/audio_processing.py
git commit -m "feat(tapo-listener): add energy gate and Whisper client"
```

---

### Task 3: Gateway WebSocket Client

**Files:**
- Create: `services/tapo-listener/gateway_client.py`

**Step 1: Write the module**

Connects to the gateway WebSocket using the same protocol as the existing `send-to-zeke.mjs` script. Sends chat messages and listens for response events.

```python
"""Gateway WebSocket client for sending messages to ZEKE."""

import asyncio
import json
import logging
import time

import websockets

log = logging.getLogger("tapo-listener.gateway")


class GatewayClient:
    def __init__(self, url: str, token: str, session_key: str = "main"):
        self._url = url
        self._token = token
        self._session_key = session_key
        self._ws = None
        self._connected = False
        self._req_id = 0
        self._pending: dict[str, asyncio.Future] = {}

    def _next_id(self) -> str:
        self._req_id += 1
        return f"tl-{self._req_id}"

    async def connect(self):
        """Connect to gateway and complete handshake."""
        self._ws = await websockets.connect(self._url)

        # Send connect frame
        req_id = self._next_id()
        await self._ws.send(json.dumps({
            "type": "req",
            "id": req_id,
            "method": "connect",
            "params": {
                "minProtocol": 3,
                "maxProtocol": 3,
                "client": {
                    "id": "cli",
                    "displayName": "Tapo Listener",
                    "platform": "macos",
                    "mode": "cli",
                    "version": "1.0.0",
                },
                "auth": {"token": self._token},
                "scopes": ["operator.admin"],
            },
        }))

        # Wait for hello-ok
        raw = await asyncio.wait_for(self._ws.recv(), timeout=10)
        frame = json.loads(raw)
        if frame.get("type") == "res" and frame.get("ok"):
            self._connected = True
            log.info("Connected to gateway")
        else:
            error = frame.get("error", {}).get("message", "unknown")
            raise ConnectionError(f"Gateway connect failed: {error}")

        # Start background message reader
        asyncio.create_task(self._read_loop())

    async def _read_loop(self):
        """Read gateway messages in background."""
        try:
            async for raw in self._ws:
                frame = json.loads(raw)
                frame_type = frame.get("type")
                frame_id = frame.get("id")

                # Resolve pending RPC responses
                if frame_type == "res" and frame_id in self._pending:
                    self._pending[frame_id].set_result(frame)
                    del self._pending[frame_id]
        except websockets.ConnectionClosed:
            log.warning("Gateway connection closed")
            self._connected = False

    async def send_chat(self, message: str) -> dict | None:
        """Send a chat message to ZEKE. Returns the response payload."""
        if not self._connected or not self._ws:
            log.warning("Not connected to gateway")
            return None

        req_id = self._next_id()
        future = asyncio.get_event_loop().create_future()
        self._pending[req_id] = future

        await self._ws.send(json.dumps({
            "type": "req",
            "id": req_id,
            "method": "chat.send",
            "params": {
                "sessionKey": self._session_key,
                "message": message,
                "idempotencyKey": f"tl-{int(time.time() * 1000)}",
            },
        }))

        try:
            result = await asyncio.wait_for(future, timeout=30)
            if result.get("ok"):
                log.info("Chat message sent, runId=%s", result.get("payload", {}).get("runId"))
                return result.get("payload")
            else:
                log.warning("Chat send failed: %s", result.get("error", {}).get("message"))
                return None
        except asyncio.TimeoutError:
            log.warning("Chat send timed out")
            self._pending.pop(req_id, None)
            return None

    async def close(self):
        if self._ws:
            await self._ws.close()
            self._connected = False

    @property
    def connected(self) -> bool:
        return self._connected
```

**Step 2: Commit**

```bash
git add services/tapo-listener/gateway_client.py
git commit -m "feat(tapo-listener): add gateway WebSocket client"
```

---

### Task 4: Wake Word Detector + Conversation Mode

**Files:**
- Create: `services/tapo-listener/wake_detector.py`

**Step 1: Write the module**

State machine: IDLE → WAKE_DETECTED → CONVERSATION → IDLE. Buffers utterances, detects silence gaps, manages conversation timeout.

```python
"""Wake word detection and conversation mode state machine."""

import logging
import re
import time

log = logging.getLogger("tapo-listener.wake")


class WakeDetector:
    # States
    IDLE = "idle"
    BUFFERING = "buffering"      # wake detected, buffering full utterance
    CONVERSATION = "conversation"  # active conversation, no wake word needed

    def __init__(
        self,
        wake_words: list[str] | None = None,
        conversation_timeout: float = 30.0,
        silence_gap: float = 2.0,
        exit_phrases: list[str] | None = None,
    ):
        self._wake_patterns = [
            re.compile(rf"\b{re.escape(w)}\b", re.IGNORECASE)
            for w in (wake_words or ["zeke"])
        ]
        self._exit_patterns = [
            re.compile(rf"\b{re.escape(p)}\b", re.IGNORECASE)
            for p in (exit_phrases or ["bye", "stop", "thanks", "thank you", "goodbye"])
        ]
        self._conversation_timeout = conversation_timeout
        self._silence_gap = silence_gap

        self._state = self.IDLE
        self._last_speech_time = 0.0
        self._conversation_start = 0.0
        self._buffered_texts: list[str] = []

    @property
    def state(self) -> str:
        return self._state

    @property
    def in_conversation(self) -> bool:
        return self._state == self.CONVERSATION

    def process_transcript(self, text: str) -> dict | None:
        """Process a transcript. Returns action dict or None.

        Possible return values:
        - {"action": "wake", "text": "full utterance"} — wake word detected, send to ZEKE
        - {"action": "message", "text": "follow-up"} — conversation follow-up, send to ZEKE
        - {"action": "end_conversation"} — conversation ended
        - None — no action (background chatter in IDLE, or silence)
        """
        now = time.monotonic()

        if not text or not text.strip():
            return self._check_timeout(now)

        self._last_speech_time = now

        if self._state == self.IDLE:
            # Check for wake word
            if self._has_wake_word(text):
                self._state = self.CONVERSATION
                self._conversation_start = now
                log.info("Wake word detected: %s", text[:80])
                return {"action": "wake", "text": text}
            return None  # background chatter, ignore

        if self._state == self.CONVERSATION:
            # Check for exit phrases
            if self._has_exit_phrase(text):
                self._state = self.IDLE
                log.info("Conversation ended by exit phrase")
                return {"action": "end_conversation"}

            # Check conversation timeout
            if now - self._conversation_start > self._conversation_timeout:
                self._state = self.IDLE
                log.info("Conversation timed out")
                return {"action": "end_conversation"}

            # It's a follow-up message
            return {"action": "message", "text": text}

        return None

    def _check_timeout(self, now: float) -> dict | None:
        """Check if conversation should end due to silence timeout."""
        if self._state == self.CONVERSATION:
            if self._last_speech_time > 0 and (now - self._last_speech_time) > self._conversation_timeout:
                self._state = self.IDLE
                log.info("Conversation ended by silence timeout")
                return {"action": "end_conversation"}
        return None

    def force_end(self):
        """Force end conversation mode."""
        self._state = self.IDLE

    def _has_wake_word(self, text: str) -> bool:
        return any(p.search(text) for p in self._wake_patterns)

    def _has_exit_phrase(self, text: str) -> bool:
        return any(p.search(text) for p in self._exit_patterns)
```

**Step 2: Commit**

```bash
git add services/tapo-listener/wake_detector.py
git commit -m "feat(tapo-listener): add wake word detector with conversation mode"
```

---

### Task 5: Main Service (server.py)

**Files:**
- Create: `services/tapo-listener/server.py`
- Create: `services/tapo-listener/requirements.txt`
- Create: `services/tapo-listener/config.example.yaml`

**Step 1: Create requirements.txt**

```
fastapi>=0.104.0
uvicorn>=0.24.0
websockets>=12.0
httpx>=0.25.0
numpy>=1.24.0
pyyaml>=6.0
pytapo>=3.3.18
```

**Step 2: Create config.example.yaml**

```yaml
camera:
  host: "192.168.1.100"
  user: "admin"
  password: "changeme"
  rtsp_port: 554
  stream: "stream1"
whisper:
  url: "http://localhost:8778"
gateway:
  url: "ws://127.0.0.1:18789"
  token: "changeme"
  session_key: "main"
ptz:
  url: "http://localhost:18791"
service:
  port: 18792
  energy_threshold: 200
  conversation_timeout: 30
  wake_words: ["zeke"]
```

**Step 3: Create server.py**

```python
#!/usr/bin/env python3
"""ZEKE Tapo Camera Listener — wake word detection + conversation via camera."""

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
                # Silence — if we have buffered audio, flush it
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
```

**Step 4: Commit**

```bash
git add services/tapo-listener/
git commit -m "feat(tapo-listener): add main service with RTSP listen loop"
```

---

### Task 6: Launchd Service + Install Script

**Files:**
- Create: `services/tapo-listener/ai.openclaw.tapo-listener.plist`
- Create: `services/tapo-listener/install.sh`

**Step 1: Create launchd plist**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>ai.openclaw.tapo-listener</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/python3</string>
        <string>INSTALL_DIR/server.py</string>
    </array>
    <key>WorkingDirectory</key>
    <string>INSTALL_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/tapo-listener.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/tapo-listener.err</string>
</dict>
</plist>
```

**Step 2: Create install.sh**

```bash
#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_NAME="ai.openclaw.tapo-listener"
PLIST_DEST="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"

echo "Installing Tapo Listener service..."

pip3 install -r "$SCRIPT_DIR/requirements.txt"

sed "s|INSTALL_DIR|$SCRIPT_DIR|g" "$SCRIPT_DIR/${PLIST_NAME}.plist" > "$PLIST_DEST"

launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load "$PLIST_DEST"

echo "Tapo Listener service installed and running."
echo "Logs: /tmp/tapo-listener.log"
echo "Test: curl http://localhost:18792/health"
```

**Step 3: Commit**

```bash
git add services/tapo-listener/ai.openclaw.tapo-listener.plist services/tapo-listener/install.sh
git commit -m "feat(tapo-listener): add launchd service and install script"
```

---

### Task 7: Deploy to Mac

**Step 1: Push to GitHub**

```bash
git push origin main
```

**Step 2: Send deploy commands to ZEKE**

Use the `send-to-zeke.mjs` script to tell ZEKE to:
1. Pull latest code
2. Create `~/.openclaw/tapo-listener.yaml` with real Tapo credentials + gateway token
3. Install and start the service
4. Test `/health` endpoint

**Step 3: Verify**

```bash
# On Mac:
curl http://localhost:18792/health
curl http://localhost:18792/status

# Test wake word:
curl -X POST http://localhost:18792/wake -H 'Content-Type: application/json' -d '{"text":"Hey ZEKE, what time is it?"}'

# Check logs:
tail -f /tmp/tapo-listener.log
```

---

### Task 8: Tune and Test

**Step 1: Verify RTSP audio**

Check that `ffmpeg` can pull audio from the Tapo camera:
```bash
ffmpeg -rtsp_transport tcp -i "rtsp://admin:PASS@TAPO_IP:554/stream1" -vn -t 5 -acodec pcm_s16le -ar 16000 -ac 1 /tmp/test_audio.raw
```

**Step 2: Verify Whisper transcription**

```bash
curl -X POST http://localhost:8778/transcribe --data-binary @/tmp/test_audio.raw -H 'Content-Type: application/octet-stream'
```

**Step 3: Tune energy threshold**

If too many silent chunks hit Whisper (high CPU), increase `energy_threshold`.
If voice is missed, decrease it. Check `/tmp/tapo-listener.log` for transcript output.

**Step 4: Test full flow**

1. Say "Hey ZEKE" near the camera
2. Camera should greet (PTZ nod)
3. Check WebChat for ZEKE's response
4. Say a follow-up (should work without wake word in conversation mode)
5. Say "bye" or wait 30s — camera should return to rest

**Step 5: Commit any tuning**

```bash
git add services/tapo-listener/
git commit -m "tune: adjust tapo-listener parameters"
```
