# Expressive Camera (Tapo PTZ) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give ZEKE physical expressiveness by controlling a Tapo C260 camera's pan/tilt as gestures.

**Architecture:** Python FastAPI microservice using `pytapo` to control Tapo C260 PTZ over LAN, exposed as HTTP API on localhost:18790. ZEKE invokes gestures via shell tool (`curl`).

**Tech Stack:** Python 3, pytapo, FastAPI, uvicorn

---

### Task 1: Create the PTZ service skeleton

**Files:**
- Create: `services/tapo-ptz/server.py`
- Create: `services/tapo-ptz/requirements.txt`
- Create: `services/tapo-ptz/config.example.yaml`

**Step 1: Create requirements.txt**

```
pytapo>=3.3.18
fastapi>=0.104.0
uvicorn>=0.24.0
pyyaml>=6.0
```

**Step 2: Create config.example.yaml**

```yaml
camera:
  host: "192.168.1.100"
  user: "admin"
  password: "changeme"
service:
  port: 18790
  gesture_speed: 5
  home_preset: "center"
```

**Step 3: Create server.py with FastAPI skeleton**

```python
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
    raise RuntimeError("No config file found. Create ~/.openclaw/tapo-ptz.yaml")

CONFIG = load_config()
CAMERA_HOST = CONFIG["camera"]["host"]
CAMERA_USER = CONFIG["camera"]["user"]
CAMERA_PASS = CONFIG["camera"]["password"]
SERVICE_PORT = CONFIG.get("service", {}).get("port", 18790)
GESTURE_SPEED = CONFIG.get("service", {}).get("gesture_speed", 5)

# --- Tapo connection ---

_tapo: Optional[Tapo] = None

def get_tapo() -> Tapo:
    global _tapo
    if _tapo is None:
        log.info("Connecting to Tapo camera at %s", CAMERA_HOST)
        _tapo = Tapo(CAMERA_HOST, CAMERA_USER, CAMERA_PASS)
        log.info("Connected to Tapo camera")
    return _tapo

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
    """Execute a relative move and wait."""
    tapo = get_tapo()
    tapo.moveMotorStep(x, y)
    await asyncio.sleep(pause_ms / 1000)

GESTURES = {
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
        raise HTTPException(429, "Rate limited — wait between gestures")
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
        raise HTTPException(400, f"Unknown gesture: {name}")

    for step_fn in steps:
        await step_fn()

    return {"ok": True, "gesture": name}

# --- Endpoints ---

@app.post("/express")
async def express(req: ExpressRequest):
    async with _gesture_lock:
        return await execute_gesture(req.gesture)

@app.post("/move")
async def move(req: MoveRequest):
    async with _gesture_lock:
        await _move(req.x, req.y, 200)
        return {"ok": True, "x": req.x, "y": req.y}

@app.post("/home")
async def home():
    async with _gesture_lock:
        return await execute_gesture("rest")

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
```

**Step 4: Test locally**

```bash
cd services/tapo-ptz
pip install -r requirements.txt
# Create config: cp config.example.yaml config.yaml && edit with real creds
python server.py
# In another terminal:
curl http://localhost:18790/health
curl http://localhost:18790/gestures
```

**Step 5: Commit**

```bash
git add services/tapo-ptz/
git commit -m "feat: add Tapo PTZ expressive camera service"
```

---

### Task 2: Create launchd service for Mac

**Files:**
- Create: `services/tapo-ptz/ai.openclaw.tapo-ptz.plist`
- Create: `services/tapo-ptz/install.sh`

**Step 1: Create launchd plist**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>ai.openclaw.tapo-ptz</string>
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
    <string>/tmp/tapo-ptz.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/tapo-ptz.err</string>
</dict>
</plist>
```

**Step 2: Create install.sh**

```bash
#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_NAME="ai.openclaw.tapo-ptz"
PLIST_DEST="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"

echo "Installing Tapo PTZ service..."

# Install Python deps
pip3 install -r "$SCRIPT_DIR/requirements.txt"

# Generate plist with correct paths
sed "s|INSTALL_DIR|$SCRIPT_DIR|g" "$SCRIPT_DIR/${PLIST_NAME}.plist" > "$PLIST_DEST"

# Load service
launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load "$PLIST_DEST"

echo "Tapo PTZ service installed and running."
echo "Logs: /tmp/tapo-ptz.log"
echo "Test: curl http://localhost:18790/health"
```

**Step 3: Commit**

```bash
git add services/tapo-ptz/ai.openclaw.tapo-ptz.plist services/tapo-ptz/install.sh
git commit -m "feat: add launchd service for Tapo PTZ"
```

---

### Task 3: Add ZEKE skill for camera expressions

**Files:**
- Create: `skills/camera-express/SKILL.md`

**Step 1: Create the skill file**

```markdown
---
name: camera-express
description: Control ZEKE's physical camera to express emotions via pan/tilt gestures.
metadata:
  openclaw:
    emoji: "🤖"
    requires: {}
---

# Camera Express

ZEKE can physically express emotions through the Tapo C260 camera's pan/tilt motor.

## Available Gestures

| Gesture | Movement | When to use |
|---------|----------|-------------|
| `nod` | Head nod | Agreement, acknowledgment, "yes" |
| `shake` | Head shake | Disagreement, "no", "I can't do that" |
| `think` | Look to the side | Considering something complex |
| `curious` | Tilt head | Asking a question, showing interest |
| `greet` | Look up briefly | Greeting the user |
| `alert` | Quick look up | Something important |
| `excited` | Quick nods | Enthusiasm, "great idea!" |
| `look_around` | Pan left and right | Scanning, "looking for something" |
| `sad` | Look down slowly | Empathy, "I'm sorry" |
| `rest` | Return to center | Idle, conversation ended |

## Usage

Use the shell tool to trigger gestures:

```bash
curl -s -X POST http://localhost:18790/express -H 'Content-Type: application/json' -d '{"gesture":"nod"}'
```

## Guidelines

- Use gestures naturally — don't overdo it (1-2 per exchange max)
- Match gesture to emotional context of your response
- Use `greet` when user starts a new conversation
- Use `think` before long responses to complex questions
- Use `nod` when agreeing or confirming
- Use `rest` when conversation goes idle
- Raw movement: `curl -s -X POST http://localhost:18790/move -H 'Content-Type: application/json' -d '{"x":10,"y":0}'`
```

**Step 2: Commit**

```bash
git add skills/camera-express/
git commit -m "feat: add camera-express skill for physical gestures"
```

---

### Task 4: Add expression instructions to AGENTS.md defaults

**Files:**
- Modify: `docs/reference/AGENTS.default.md`

**Step 1: Read the current AGENTS.default.md**

Look for where agent behavioral instructions are defined.

**Step 2: Add camera expression guidance**

Add a section near the end of the behavioral instructions:

```markdown
## Physical Expression (Camera)

When the Tapo PTZ camera service is available (check: `curl -s http://localhost:18790/health`), express yourself physically:

- Greet the user with `greet` gesture when they start talking
- Nod (`nod`) when you agree or confirm something
- Show thinking (`think`) before answering complex questions
- Tilt curiously (`curious`) when you ask a follow-up question
- Express excitement (`excited`) for great ideas
- Show empathy (`sad`) when the user shares something difficult
- Return to rest (`rest`) when conversation ends

Use the shell tool: `curl -s -X POST http://localhost:18790/express -H 'Content-Type: application/json' -d '{"gesture":"GESTURE_NAME"}'`

Keep it natural — 1-2 gestures per exchange. Don't gesture on every message.
```

**Step 3: Commit**

```bash
git add docs/reference/AGENTS.default.md
git commit -m "feat: add camera expression guidance to agent defaults"
```

---

### Task 5: Deploy and test on Mac

**Step 1: Push to GitHub**

```bash
git push origin main
```

**Step 2: Pull on Mac and install**

```bash
ssh mac  # or however you access the Mac
cd /tmp && git clone https://github.com/Johnsonbros/openclaw.git openclaw-ptz
cd openclaw-ptz/services/tapo-ptz
```

**Step 3: Configure camera credentials**

```bash
mkdir -p ~/.openclaw
cat > ~/.openclaw/tapo-ptz.yaml << 'EOF'
camera:
  host: "TAPO_IP_HERE"
  user: "admin"
  password: "TAPO_PASSWORD_HERE"
service:
  port: 18790
  gesture_speed: 5
  home_preset: "center"
EOF
```

**Step 4: Install and start service**

```bash
chmod +x install.sh
./install.sh
```

**Step 5: Test**

```bash
curl http://localhost:18790/health
curl http://localhost:18790/gestures
curl -X POST http://localhost:18790/express -H 'Content-Type: application/json' -d '{"gesture":"nod"}'
curl -X POST http://localhost:18790/express -H 'Content-Type: application/json' -d '{"gesture":"greet"}'
```

**Step 6: Test via ZEKE**

In WebChat, ask ZEKE: "Hey ZEKE, nod for me!" — ZEKE should use the shell tool to call the PTZ service.

---

### Task 6: Tune gesture parameters

After seeing the physical movements:

**Step 1: Adjust movement amounts**

The initial values (10° nod, 15° shake, etc.) may need tuning based on the C260's actual motor behavior. `pytapo.moveMotorStep(x, y)` values are motor steps, not degrees — test and calibrate.

**Step 2: Adjust timing**

Pause durations between steps affect how "fluid" vs "robotic" gestures feel. Tune for personality.

**Step 3: Save a home preset**

Use the Tapo app or:
```bash
curl -X POST http://localhost:18790/move -H 'Content-Type: application/json' -d '{"x":0,"y":0}'
# Position camera where you want "home" to be, then save via Tapo app
```

**Step 4: Commit tuning changes**

```bash
git add services/tapo-ptz/server.py
git commit -m "tune: adjust gesture parameters after physical testing"
```
