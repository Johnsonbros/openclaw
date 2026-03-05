# ZEKE Expressive Camera — Tapo C260 PTZ Control

## Concept

The Tapo C260 pan/tilt camera acts as ZEKE's physical "head." ZEKE expresses emotions through physical camera movements — nodding for agreement, tilting for curiosity, shaking for disagreement, etc. The camera is on the same LAN as the Mac gateway.

## Control Model

**Both automatic and intentional:**
- **Automatic**: After each ZEKE response, lightweight sentiment analysis triggers an appropriate gesture
- **Agent tool**: ZEKE can explicitly call `camera_express(gesture: "nod")` via the `nodes` tool

## Expression Library

| Gesture | Movement | Trigger |
|---------|----------|---------|
| `nod` | Tilt down 10°, pause 200ms, tilt up 10° | Agreement, acknowledgment, "yes" |
| `shake` | Pan left 15°, right 30°, left 15° to center | Disagreement, "no", "I can't" |
| `think` | Slow pan right 10°, pause 800ms, return | Considering, processing complex query |
| `curious` | Tilt right 8°, hold 500ms, return | Question, interest, "tell me more" |
| `greet` | Small tilt up 5°, return | Hello, welcome back |
| `alert` | Snap to home, quick tilt up 5° | Important/urgent message |
| `rest` | Return to home preset position | Idle, end of conversation |
| `excited` | 3x small quick nods (5° each) | Enthusiasm, "great idea!" |
| `look_around` | Slow pan left 20°, right 40°, center | Scanning, "looking for something" |
| `sad` | Slow tilt down 8°, hold 600ms, slow return | Empathy, "I'm sorry" |

## Architecture

### Component: `services/tapo-ptz/server.py`

A small Python FastAPI/Flask microservice running on the Mac alongside the gateway:

```
Mac LAN
├── OpenClaw Gateway (port 18789)
└── Tapo PTZ Service (port 18790)
    └── pytapo → Tapo C260 (LAN IP)
```

**Why a microservice instead of a script?**
- PTZ movements are sequential (gestures are multi-step) — needs state
- `pytapo` auth session should be reused, not re-created each call
- The service can queue gestures and prevent conflicting movements
- Health check endpoint for monitoring

### API Endpoints

```
POST /express     { gesture: "nod" }         → execute named gesture
POST /move        { x: 10, y: -5 }           → raw relative move
POST /home                                    → return to home preset
GET  /status                                  → current position + state
GET  /health                                  → service health check
```

### Integration with ZEKE

**Option 1 (recommended): Shell tool invocation**
ZEKE calls the PTZ service via `curl` from the shell tool:
```bash
curl -s -X POST http://localhost:18790/express -d '{"gesture":"nod"}'
```

**Option 2: New node command `camera.ptz`**
Add to the node protocol — more work, better long-term fit.

**We'll start with Option 1** (shell via curl) since it's simpler and ZEKE already has shell access. Can migrate to a proper node command later.

### Automatic Triggers

In the agent's post-response hook or system prompt, add instructions:
- After greeting → `greet`
- After agreeing with user → `nod`
- After saying no/can't → `shake`
- When processing a complex request → `think`
- When asking a question → `curious`
- When expressing empathy → `sad`
- When excited about something → `excited`

This can be implemented via ZEKE's AGENTS.md instructions — no code needed for the automatic part, just prompt engineering that tells ZEKE to use the tool after responses.

### Configuration

```yaml
# ~/.openclaw/tapo-ptz.yaml
camera:
  host: "192.168.x.x"    # Tapo C260 LAN IP
  user: "admin"           # or Tapo account username
  password: "..."         # camera password
service:
  port: 18790
  gesture_speed: 5        # 1-9, default 5
  home_preset: "center"   # preset name for home position
```

Credentials can also be pulled from `~/.config/camsnap/config.yaml` if configured there.

## Safety

- All gestures have bounded movement ranges (max ±30° pan, ±15° tilt)
- Gesture queue with max depth (prevent spam)
- Rate limiting: max 1 gesture per 2 seconds
- Home position timeout: return to home after 30s of no commands
- Service only listens on localhost (127.0.0.1)

## Dependencies

- Python 3.9+
- `pytapo` (`pip install pytapo`)
- `fastapi` + `uvicorn` (or `flask`)
- Network access to Tapo C260 on LAN
