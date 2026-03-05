#!/usr/bin/env python3
"""ZEKE Expressive Camera — Tapo C260 PTZ control service."""

import asyncio
import logging
import os
import time
from pathlib import Path
from typing import Optional

import yaml
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from pytapo import Tapo

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("tapo-ptz")

app = FastAPI(title="ZEKE Tapo PTZ")

# --- Config ---

def load_config() -> dict:
    config_paths = [
        Path(os.environ.get("TAPO_PTZ_CONFIG", "")),
        Path.home() / ".openclaw" / "tapo-ptz.yaml",
        Path(__file__).parent / "config.yaml",
    ]
    for p in config_paths:
        if p.is_file():
            log.info("Loading config from %s", p)
            return yaml.safe_load(p.read_text())
    raise RuntimeError("No config file found. Create ~/.openclaw/tapo-ptz.yaml or set TAPO_PTZ_CONFIG env var")

CONFIG = load_config()
CAMERA_HOST = CONFIG["camera"]["host"]
CAMERA_USER = CONFIG["camera"]["user"]
CAMERA_PASS = CONFIG["camera"]["password"]
SERVICE_PORT = CONFIG.get("service", {}).get("port", 18790)
GESTURE_SPEED = CONFIG.get("service", {}).get("gesture_speed", 5)

# --- Tapo connection ---

_tapo: Optional[Tapo] = None
_tapo_lock = asyncio.Lock()

def get_tapo() -> Tapo:
    global _tapo
    if _tapo is None:
        log.info("Connecting to Tapo camera at %s", CAMERA_HOST)
        _tapo = Tapo(CAMERA_HOST, CAMERA_USER, CAMERA_PASS)
        log.info("Connected to Tapo camera")
    return _tapo

def reset_tapo():
    global _tapo
    _tapo = None

# --- Gesture lock (serial execution) ---

_gesture_lock = asyncio.Lock()
_last_gesture_time = 0.0
RATE_LIMIT_SECONDS = 2.0

# --- Models ---

class ExpressRequest(BaseModel):
    gesture: str

class MoveRequest(BaseModel):
    x: int = 0
    y: int = 0

# --- Gesture definitions ---

async def _move(x: int, y: int, pause_ms: int = 200):
    """Execute a relative motor step and wait."""
    tapo = get_tapo()
    tapo.moveMotor(x, y)
    await asyncio.sleep(pause_ms / 1000)

GESTURES: dict[str, list] = {
    "nod": [
        lambda: _move(0, -10, 200),
        lambda: _move(0, 10, 200),
    ],
    "shake": [
        lambda: _move(-15, 0, 200),
        lambda: _move(30, 0, 200),
        lambda: _move(-15, 0, 200),
    ],
    "think": [
        lambda: _move(10, 0, 800),
        lambda: _move(-10, 0, 300),
    ],
    "curious": [
        lambda: _move(0, -8, 500),
        lambda: _move(0, 8, 300),
    ],
    "greet": [
        lambda: _move(0, 5, 300),
        lambda: _move(0, -5, 200),
    ],
    "alert": [
        lambda: _move(0, 5, 150),
        lambda: _move(0, -5, 150),
    ],
    "excited": [
        lambda: _move(0, -5, 100),
        lambda: _move(0, 5, 100),
        lambda: _move(0, -5, 100),
        lambda: _move(0, 5, 100),
        lambda: _move(0, -5, 100),
        lambda: _move(0, 5, 100),
    ],
    "look_around": [
        lambda: _move(-20, 0, 400),
        lambda: _move(40, 0, 400),
        lambda: _move(-20, 0, 300),
    ],
    "sad": [
        lambda: _move(0, -8, 600),
        lambda: _move(0, 8, 400),
    ],
    "rest": [],  # handled specially — go to home preset
}

async def execute_gesture(name: str):
    global _last_gesture_time
    now = time.monotonic()
    if now - _last_gesture_time < RATE_LIMIT_SECONDS:
        raise HTTPException(429, detail="Rate limited — wait between gestures")
    _last_gesture_time = now

    if name == "rest":
        tapo = get_tapo()
        home = CONFIG.get("service", {}).get("home_preset", "center")
        try:
            tapo.setPreset(home)
        except Exception:
            log.warning("Home preset '%s' not found, skipping", home)
        return {"ok": True, "gesture": name}

    steps = GESTURES.get(name)
    if steps is None:
        raise HTTPException(400, detail=f"Unknown gesture: {name}. Available: {list(GESTURES.keys())}")

    for step_fn in steps:
        await step_fn()

    return {"ok": True, "gesture": name}

# --- Endpoints ---

@app.post("/express")
async def express(req: ExpressRequest):
    async with _gesture_lock:
        try:
            return await execute_gesture(req.gesture)
        except HTTPException:
            raise
        except Exception as e:
            log.error("Gesture '%s' failed: %s", req.gesture, e)
            reset_tapo()
            raise HTTPException(500, detail=f"Gesture failed: {e}")

@app.post("/move")
async def move(req: MoveRequest):
    async with _gesture_lock:
        try:
            await _move(req.x, req.y, 200)
            return {"ok": True, "x": req.x, "y": req.y}
        except Exception as e:
            log.error("Move failed: %s", e)
            reset_tapo()
            raise HTTPException(500, detail=f"Move failed: {e}")

@app.post("/home")
async def home():
    async with _gesture_lock:
        try:
            return await execute_gesture("rest")
        except HTTPException:
            raise
        except Exception as e:
            log.error("Home failed: %s", e)
            reset_tapo()
            raise HTTPException(500, detail=f"Home failed: {e}")

@app.get("/status")
async def status():
    try:
        tapo = get_tapo()
        return {"ok": True, "connected": True, "host": CAMERA_HOST}
    except Exception as e:
        return {"ok": False, "connected": False, "error": str(e)}

@app.get("/health")
async def health():
    return {"ok": True, "service": "tapo-ptz"}

@app.get("/gestures")
async def list_gestures():
    return {"gestures": list(GESTURES.keys())}

# --- Main ---

if __name__ == "__main__":
    import uvicorn
    log.info("Starting Tapo PTZ service on port %d", SERVICE_PORT)
    uvicorn.run(app, host="127.0.0.1", port=SERVICE_PORT, log_level="info")
