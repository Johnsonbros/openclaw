---
summary: "BLE Pendant plugin: audio streaming, transcription, intent detection, task management, location reminders, people profiles, and long-term memory"
read_when:
  - Configuring pendant audio transcription
  - Setting up location-based reminders
  - Managing tasks and reminders via voice
  - Linking voice profiles to people
  - Understanding pendant memory auto-save
title: "BLE Pendant Plugin"
---

# BLE Pendant (plugin)

Audio streaming, transcription, intent detection, task management, location-based
reminders, and long-term memory from BLE pendant devices.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Android Node                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────────┐  │
│  │ BLE Pendant  │───▶│ PendantService│───▶│ WebSocket (pendant.audio)│  │
│  │  (hardware)  │    │   (Kotlin)   │    └──────────────────────────┘  │
│  └──────────────┘    └──────────────┘                                   │
│                      ┌──────────────┐    ┌──────────────────────────┐  │
│                      │LocationManager│───▶│ WebSocket (geofence.*)   │  │
│                      │  (Kotlin)    │    └──────────────────────────┘  │
│                      └──────────────┘                                   │
└─────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼ WebSocket
┌─────────────────────────────────────────────────────────────────────────┐
│                         Gateway + Pendant Plugin                         │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────────┐  │
│  │ Audio Buffer │───▶│  Software    │───▶│   STT Provider           │  │
│  │   (PCM)      │    │    VAD       │    │ (gateway/deepgram/whisper)│  │
│  └──────────────┘    └──────────────┘    └──────────────────────────┘  │
│                                                      │                   │
│                                                      ▼                   │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────────┐  │
│  │   Speaker    │◀───│  Transcript  │◀───│   Intent Classifier      │  │
│  │  Diarization │    │              │    │                          │  │
│  └──────────────┘    └──────────────┘    └──────────────────────────┘  │
│         │                    │                       │                   │
│         ▼                    ▼                       ▼                   │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────────┐  │
│  │Voice Profiles│    │Memory Auto-  │    │ Task/Location/People     │  │
│  │   Storage    │    │   Save       │    │      Managers            │  │
│  └──────────────┘    └──────────────┘    └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## What Runs Where

| Component             | Location           | Purpose                                       |
| --------------------- | ------------------ | --------------------------------------------- |
| BLE communication     | Android            | Connects to pendant hardware via Bluetooth LE |
| Audio buffering       | Android            | Accumulates PCM audio chunks                  |
| Geofence monitoring   | Android            | Google Play Services location API             |
| Software VAD          | Gateway            | Filters silence before STT API calls          |
| STT transcription     | Gateway (or cloud) | Converts audio to text                        |
| Speaker diarization   | Gateway            | Voice fingerprinting and identification       |
| Intent classification | Gateway            | Pattern matching for voice commands           |
| Task/location storage | Gateway            | Plugin storage API                            |
| Memory auto-save      | Gateway            | Writes transcripts to memory directory        |

## Install

```bash
openclaw plugins install ./extensions/pendant
cd ./extensions/pendant && pnpm install
```

Restart the Gateway afterwards.

## Configuration

Set config under `plugins.entries.pendant.config`:

```json5
{
  plugins: {
    entries: {
      pendant: {
        enabled: true,
        config: {
          // STT Provider
          sttProvider: "gateway", // "gateway" | "deepgram" | "whisper"
          deepgramApiKey: "...", // Required if sttProvider is "deepgram"
          whisperEndpoint: "http://localhost:9000/v1/audio/transcriptions",

          // Audio Processing
          autoTranscribe: true,
          bufferDurationMs: 1000, // 100-10000ms

          // Voice Activity Detection (redundant safety net)
          enableSoftwareVAD: true,
          vadEnergyThreshold: 0.01, // 0.001-0.5, lower = more sensitive
          vadSpeechRatio: 0.1, // 0.01-1, lower = more permissive

          // Speaker Diarization
          enableSpeakerDiarization: true,
          speakerMatchThreshold: 0.75, // 0-1, higher = stricter
          autoCreateVoiceProfiles: true,

          // Intent Detection
          enableIntentDetection: true,
          intentConfidenceThreshold: 0.7, // 0-1

          // Memory Auto-Save
          autoSaveToMemory: true,
          memoryFlushIntervalMs: 300000, // 5 minutes
          memoryFlushMinEntries: 5,

          // Location Reminders
          locationDefaultRadiusMeters: 100,
          locationReminderMode: "both", // "notification" | "ai_message" | "both"
        },
      },
    },
  },
}
```

## Intent Detection

The plugin automatically detects intents from transcripts:

| Intent Type             | Trigger Phrases                               | Example                         |
| ----------------------- | --------------------------------------------- | ------------------------------- |
| `task_create`           | "remind me", "add to my list", "don't forget" | "Remind me to call John"        |
| `task_create_location`  | "when I get to", "when I leave"               | "Remind me when I get home"     |
| `task_list`             | "what's on my list", "show my tasks"          | "What are my reminders?"        |
| `task_complete`         | "mark as done", "complete"                    | "Mark the first task as done"   |
| `location_save`         | "save this location", "mark this place"       | "Save this as home"             |
| `location_group`        | "add to group", "create group"                | "Add this to my grocery stores" |
| `person_location_set`   | "John's home is", "Sarah works at"            | "John's home is 123 Main St"    |
| `person_location_query` | "where does John live"                        | "What's Sarah's work address?"  |
| `memory_save`           | "remember this", "note that"                  | "Remember that I parked in B3"  |

Intent confidence must exceed `intentConfidenceThreshold` (default 0.7) to trigger actions.

## Voice Activity Detection (VAD)

The plugin includes software VAD as a safety net to complement the pendant's
hardware VAD. This prevents wasting STT API calls on silence.

How it works:

1. Calculate RMS energy for each audio frame (256 samples)
2. Count frames exceeding `vadEnergyThreshold`
3. If speech frame ratio < `vadSpeechRatio`, skip STT

Configuration:

```json5
{
  enableSoftwareVAD: true,
  vadEnergyThreshold: 0.01, // Lower = more sensitive to quiet speech
  vadSpeechRatio: 0.1, // 10% of frames must contain speech
}
```

## Tools

### Pendant Control

| Tool                     | Description                                   |
| ------------------------ | --------------------------------------------- |
| `pendant_control`        | Scan, connect, disconnect BLE pendant devices |
| `pendant_channel_status` | Get audio channel status and speaker history  |

### Voice Profiles

| Tool                     | Description                      |
| ------------------------ | -------------------------------- |
| `voice_profile_list`     | List all known voice profiles    |
| `voice_profile_identify` | Assign a name to a voice profile |

### Tasks

| Tool                           | Description                                       |
| ------------------------------ | ------------------------------------------------- |
| `pendant_task_create`          | Create a task with optional time/location trigger |
| `pendant_task_list`            | List pending tasks and reminders                  |
| `pendant_task_complete`        | Mark a task as completed                          |
| `pendant_task_delete`          | Delete a task                                     |
| `pendant_task_clear_completed` | Remove all completed tasks                        |

### Locations

| Tool                    | Description                                      |
| ----------------------- | ------------------------------------------------ |
| `location_save`         | Save current location with name and radius       |
| `location_list`         | List all saved locations                         |
| `location_update`       | Update location name, radius, or starred status  |
| `location_delete`       | Delete a saved location                          |
| `location_group_create` | Create a location group (e.g., "Grocery Stores") |
| `location_group_add`    | Add a location to a group                        |
| `location_group_remove` | Remove a location from a group                   |
| `location_group_list`   | List all location groups                         |

### People Profiles

| Tool                     | Description                                |
| ------------------------ | ------------------------------------------ |
| `person_profile_create`  | Create a person profile                    |
| `person_profile_update`  | Update name, relationship, notes           |
| `person_profile_list`    | List all people profiles                   |
| `person_profile_get`     | Get detailed person info                   |
| `person_location_add`    | Add location tag to person ("John's home") |
| `person_location_remove` | Remove location tag from person            |
| `person_location_list`   | List person's saved locations              |
| `person_voice_link`      | Link voice profile to person               |

### Memory

| Tool                    | Description                          |
| ----------------------- | ------------------------------------ |
| `pendant_memory_status` | Get memory auto-save statistics      |
| `pendant_memory_flush`  | Manually flush transcripts to memory |

## Events

### Emitted Events

| Event                      | Description                                      |
| -------------------------- | ------------------------------------------------ |
| `pendant.transcript`       | Transcript with speaker info and detected intent |
| `pendant.intent`           | Detected intent from transcript                  |
| `pendant.task.created`     | Task created from voice input                    |
| `pendant.task.triggered`   | Location-based task triggered                    |
| `pendant.location.saved`   | Location saved (Android registers geofence)      |
| `pendant.location.updated` | Location updated (Android updates geofence)      |
| `pendant.location.deleted` | Location deleted (Android removes geofence)      |
| `channel.message`          | Transcript for AI processing                     |

### Listened Events

| Event                    | Description                       |
| ------------------------ | --------------------------------- |
| `pendant.audio`          | PCM audio data from Android node  |
| `pendant.geofence.enter` | Geofence enter event from Android |
| `pendant.geofence.exit`  | Geofence exit event from Android  |

## Storage Keys

| Key                       | Description                        |
| ------------------------- | ---------------------------------- |
| `pendant:voice_profiles`  | Voice fingerprints and profiles    |
| `pendant:tasks`           | Tasks and reminders                |
| `pendant:locations`       | Saved locations with coordinates   |
| `pendant:location_groups` | Location groups                    |
| `pendant:people_profiles` | People profiles with location tags |

## Memory Auto-Save

The plugin automatically saves pendant transcripts to the `memory/` directory
for later search via the memory system.

Output format (Markdown):

```markdown
## Pendant Transcript

**Session:** abc123...
**Period:** 2:30 PM - 2:45 PM
**Entries:** 12

- [2:30:15 PM] **Alice**: Remember to buy groceries _(task_create)_
- [2:31:02 PM] _Speaker abc123_: The meeting is at 3pm
- [2:32:45 PM] **Alice**: Save this location as the office
```

Files are named: `memory/pendant-YYYY-MM-DD-HHMM.md`

## Android Permissions

The Android node requires these permissions:

```xml
<!-- BLE -->
<uses-permission android:name="android.permission.BLUETOOTH" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />

<!-- Location (Geofencing) -->
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
```

## Example Voice Commands

### Time-Based Tasks

```
"Remind me to call John tomorrow at 3pm"
"Add milk to my shopping list"
"Don't forget to send the report"
```

### Location-Based Tasks

```
"When I get home, remind me to take out the trash"
"Remind me to buy milk when I leave work"
"Alert me when I'm near any grocery store"
```

### Location Management

```
"Save this location as home"
"Star this place as my favorite coffee shop"
"Create a group called grocery stores"
"Add Trader Joe's to my grocery stores"
```

### People + Locations

```
"John's home is at 123 Main Street"
"Sarah works at the Google campus"
"Remind me to call John when I'm near his house"
"Where does Sarah live?"
```

### Memory

```
"Remember that I parked in section B3"
"Note that the wifi password is opensesame"
```

## Geofencing Flow

1. User saves a location or creates a location-based task
2. Plugin emits `pendant.location.saved` event
3. Android node receives event and registers geofence with Google Play Services
4. When user enters/exits geofence, Android sends `pendant.geofence.enter/exit`
5. Plugin checks for matching tasks and triggers notifications or AI messages

## Speaker Diarization Flow

1. Audio arrives from pendant
2. Plugin detects speech segments using VAD
3. Voice embedding generated for each segment
4. Embedding compared against known profiles (cosine similarity)
5. If match confidence >= threshold, speaker identified
6. Otherwise, new profile auto-created (if enabled)
7. Transcript includes speaker ID and name (if known)

## Troubleshooting

### No transcription output

1. Check `autoTranscribe` is `true`
2. Verify STT provider is configured (API key for Deepgram, endpoint for Whisper)
3. Check VAD settings - increase `vadSpeechRatio` if too strict

### Geofences not triggering

1. Verify Android has background location permission
2. Check `locationDefaultRadiusMeters` - too small may miss triggers
3. Ensure device is not in battery saver mode

### Voice profiles not matching

1. Lower `speakerMatchThreshold` (e.g., 0.6)
2. Ensure multiple audio samples collected for better matching
3. Check audio quality from pendant

### Memory files not created

1. Verify `autoSaveToMemory` is `true`
2. Check `memory/` directory exists and is writable
3. Wait for flush interval or use `pendant_memory_flush` tool
