# "Hey ZEKE" — Tapo Camera Wake Word + Person Tracking

## Concept

ZEKE is always listening through the Tapo C260 camera's microphone. When someone says "Hey ZEKE", the camera physically turns to face the speaker and ZEKE engages in two-way conversation — hearing through the camera mic and talking back through the camera speaker.

## Architecture

A new Python sidecar service (`services/tapo-listener/`) running on the Mac alongside the gateway. It bridges the Tapo C260 camera into ZEKE's existing audio pipeline.

```
Tapo C260 Camera (LAN)
  │
  ├─ RTSP audio stream ──→ tapo-listener (Mac, port 18792)
  │                           ├─ ffmpeg extracts PCM 16kHz mono
  │                           ├─ 1s chunks → Whisper (localhost:8778)
  │                           ├─ "ZEKE" in transcript → Gateway WS
  │                           │    → ZEKE agent processes message
  │                           ├─ Person detection → PTZ service
  │                           │    → camera faces the speaker
  │                           └─ TTS audio → Tapo speaker
  │
  ├─ Person detection events ─→ tapo-listener (via pytapo API)
  │
  └─ Speaker (backchannel) ←── TTS playback (ffmpeg RTSP push)
```

## Components

### 1. RTSP Audio Capture

- `ffmpeg` subprocess pulls `rtsp://<user>:<pass>@<tapo-ip>:554/stream1`
- Extracts audio only: `-vn -acodec pcm_s16le -ar 16000 -ac 1 -f s16le pipe:1`
- Service reads stdout in 1-second chunks (32,000 bytes = 16000 samples × 2 bytes)
- Reconnects with exponential backoff if RTSP drops

### 2. Wake Word Detection + Transcription

- Each 1-second PCM chunk is POSTed to the existing Whisper server (`localhost:8778/transcribe`)
- Energy gate first: skip silent chunks (RMS < threshold) to reduce Whisper load
- If transcript contains `/\bzeke\b/i`, treat as **wake event**
- On wake:
  - Buffer the full utterance (continue capturing until 2s of silence)
  - Send complete transcript to ZEKE gateway via WebSocket (`chat.send`)
  - Trigger person detection + PTZ tracking

### 3. Person Detection + PTZ Tracking

- On wake event, query `pytapo.getEvents()` for recent person detection events
- The Tapo C260 has built-in AI person detection — no external CV needed
- If person detected, estimate position relative to camera FOV
- Call PTZ service (`localhost:18791/express`) with `greet` gesture, or use `pytapo.moveMotor()` to pan toward the person's position
- If no person detection data available, do a slow scan pattern (pan left-right) until person is found via a quick `camera.snap` + vision analysis

### 4. Gateway Integration

- Uses the same WebSocket protocol as the deploy script:
  - Connect: `{ type: "req", method: "connect", params: { client: { id: "cli", mode: "cli" }, auth: { token } } }`
  - Send: `{ type: "req", method: "chat.send", params: { sessionKey, message } }`
- Subscribes to response events to know when ZEKE has finished responding
- The transcript is prefixed with `[CAMERA MIC]` for provenance tracking

### 5. TTS Playback via Tapo Speaker

- After ZEKE responds, the gateway generates TTS audio (ElevenLabs/OpenAI/Edge)
- The listener service fetches the TTS audio file
- Plays it through the Tapo C260's speaker via:
  - **Option A**: `ffmpeg` RTSP backchannel push (ONVIF two-way audio)
  - **Option B**: `pytapo` two-way audio API if available
  - **Fallback**: Play through Mac speakers using `afplay`
- Audio format: PCM or MP3, converted as needed

### 6. Conversation Mode

After wake, ZEKE enters "conversation mode" for 30 seconds:
- Continuous listening (no wake word needed for follow-ups)
- Each utterance sent to ZEKE as chat message
- Camera tracks person during conversation
- Mode ends after 30s of silence or user says "bye"/"stop"/"thanks"
- On exit, PTZ returns to home position (`rest` gesture)

## Service API (port 18792)

```
GET  /health         → { ok, listening, connected }
GET  /status         → { rtsp_connected, whisper_ok, gateway_ok, last_wake, conversation_mode }
POST /wake           → force wake event (for testing)
POST /stop           → stop listening
POST /start          → start listening
```

## Configuration

```yaml
# ~/.openclaw/tapo-listener.yaml
camera:
  host: "192.168.x.x"
  user: "admin"
  password: "..."
  rtsp_port: 554
  stream: "stream1"       # stream1 = high quality, stream2 = low quality
whisper:
  url: "http://localhost:8778"
gateway:
  url: "ws://127.0.0.1:18789"
  token: "..."
  session_key: "main"
ptz:
  url: "http://localhost:18791"
service:
  port: 18792
  energy_threshold: 200   # RMS silence gate
  conversation_timeout: 30  # seconds of silence before ending conversation
  wake_words: ["zeke"]
```

## Dependencies

- Python 3.9+
- `pytapo` (camera control + events)
- `fastapi` + `uvicorn` (service API)
- `websockets` (gateway connection)
- `pyyaml` (config)
- `numpy` (audio energy calculation)
- `ffmpeg` on PATH (RTSP audio extraction)

## Safety

- Audio is processed locally (Whisper runs on Mac) — never sent to cloud for wake detection
- RTSP credentials stored locally in config file
- Service only listens on localhost
- Conversation mode auto-exits after timeout
- Energy gate prevents constant Whisper calls on silence
- Rate limiting on wake events (max 1 per 5 seconds)

## Future Enhancements

- Speaker diarization (identify WHO is speaking)
- Multi-person tracking (prioritize the person addressing ZEKE)
- Tapo motion detection → proactive alerts ("Someone's at the door")
- Visual scene analysis (periodic snapshots for situational awareness)
- Integration with Sonos/HomePod for better audio output
