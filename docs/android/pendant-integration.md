---
summary: "Android pendant integration guide: admin session, geofencing, ElevenLabs TTS, and voice recognition"
read_when:
  - Integrating pendant with Android app
  - Adding admin access to Android app
  - Wiring up geofence events
  - Setting up ElevenLabs voice for real-time conversation
title: "Android Pendant Integration"
---

# Android Pendant Integration Guide

This guide covers the full integration of the pendant system with the Android app,
including admin session access, geofencing, and ElevenLabs real-time voice.

## Overview

The Android app needs these features for full pendant integration:

1. **Admin Session Access** - Chat with full gateway permissions
2. **Geofence Event Forwarding** - Send location events to backend
3. **ElevenLabs TTS** - Real-time voice responses
4. **Voice Identity** - Create private voice for self-recognition

---

## 1. Admin Session Access

### Current State

The app has two sessions in `NodeRuntime.kt`:

- `operatorSession` - Role "operator" with empty scopes (limited access)
- `nodeSession` - Role "node" (device capabilities only)

### Required Change

Update `buildOperatorConnectOptions()` to include admin scopes:

```kotlin
// In NodeRuntime.kt

private fun buildOperatorConnectOptions(): GatewayConnectOptions {
  return GatewayConnectOptions(
    role = "operator",
    scopes = listOf("operator.admin"),  // ADD THIS LINE
    caps = emptyList(),
    commands = emptyList(),
    permissions = emptyMap(),
    client = buildClientInfo(clientId = "openclaw-control-ui", clientMode = "ui"),
    userAgent = buildUserAgent(),
  )
}
```

### Scope Options

| Scope                | Access Level                           |
| -------------------- | -------------------------------------- |
| `operator.admin`     | Full admin access (all methods)        |
| `operator.write`     | Send messages, invoke nodes, talk mode |
| `operator.read`      | View logs, status, history             |
| `operator.approvals` | Approve/reject exec requests           |
| `operator.pairing`   | Pair/unpair devices                    |

For a full-featured pendant app, use `operator.admin`.

---

## 2. Geofence Event Forwarding

### Architecture

```
Android                           Gateway (Backend)
=======                           =================

LocationManager.registerGeofence ←── pendant.location.saved event
       │
       ▼
GeofenceBroadcastReceiver (system callback)
       │
       ▼
LocationManager.handleGeofenceTransition
       │
       ▼
GeofenceCallback.onGeofenceEvent
       │
       ▼
nodeSession.sendNodeEvent ────────▶ pendant.geofence.enter/exit
       │
       ▼                           TaskManager checks for matching tasks
       │                                    ▼
       │                           pendant.task.triggered event
       │
       ◀─────────────────────────── Android notification / AI message
```

### Step 1: Initialize LocationManager

In `NodeApp.kt` or application initialization:

```kotlin
class NodeApp : Application() {
  lateinit var locationManager: ai.openclaw.android.location.LocationManager
    private set

  private val locationScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

  override fun onCreate() {
    super.onCreate()

    // Initialize LocationManager
    locationManager = ai.openclaw.android.location.LocationManager(this, locationScope)

    // Set static reference for BroadcastReceiver
    GeofenceBroadcastReceiver.locationManager = locationManager

    // Check for pending re-registration from boot
    if (LocationPersistence.hasPendingReregistration(this)) {
      val locations = LocationPersistence.loadLocations(this)
      locationManager.reregisterGeofences(locations)
      LocationPersistence.clearPendingReregistration(this)
    }
  }
}
```

### Step 2: Set Up Geofence Callback

In `NodeRuntime.kt`, after initializing nodeSession:

```kotlin
// In NodeRuntime init block or constructor
private fun setupGeofenceCallback() {
  val app = appContext.applicationContext as? NodeApp ?: return
  val locManager = app.locationManager

  locManager.setCallback(object : GeofenceCallback {
    override fun onGeofenceEvent(event: GeofenceEvent) {
      // Only send if connected
      if (!nodeConnected) return

      val eventName = when (event.eventType) {
        GeofenceEventType.ENTER -> "pendant.geofence.enter"
        GeofenceEventType.EXIT -> "pendant.geofence.exit"
        GeofenceEventType.DWELL -> "pendant.geofence.enter"  // Treat dwell as enter
      }

      scope.launch {
        try {
          nodeSession.sendNodeEvent(
            event = eventName,
            payloadJson = buildJsonObject {
              put("locationId", JsonPrimitive(event.locationId))
              put("locationName", JsonPrimitive(event.locationName))
              put("timestamp", JsonPrimitive(event.timestamp))
            }.toString()
          )
        } catch (e: Throwable) {
          Log.e("NodeRuntime", "Failed to send geofence event", e)
        }
      }
    }
  })
}
```

### Step 3: Handle Location Events from Gateway

Add handler for gateway events in `handleGatewayEvent`:

```kotlin
private fun handleGatewayEvent(event: String, payloadJson: String?) {
  when (event) {
    // ... existing handlers ...

    "pendant.location.saved" -> handleLocationSaved(payloadJson)
    "pendant.location.updated" -> handleLocationUpdated(payloadJson)
    "pendant.location.deleted" -> handleLocationDeleted(payloadJson)
    "pendant.task.triggered" -> handleTaskTriggered(payloadJson)
  }
}

private fun handleLocationSaved(payloadJson: String?) {
  if (payloadJson.isNullOrBlank()) return
  scope.launch(Dispatchers.IO) {
    try {
      val location = json.decodeFromString<SavedLocation>(payloadJson)
      val app = appContext.applicationContext as? NodeApp ?: return@launch

      // Register geofence
      val success = app.locationManager.registerGeofence(location)
      if (success) {
        // Persist for boot recovery
        LocationPersistence.addLocation(appContext, location)
        Log.i("NodeRuntime", "Registered geofence: ${location.name}")
      }
    } catch (e: Throwable) {
      Log.e("NodeRuntime", "Failed to handle location.saved", e)
    }
  }
}

private fun handleLocationUpdated(payloadJson: String?) {
  if (payloadJson.isNullOrBlank()) return
  scope.launch(Dispatchers.IO) {
    try {
      val location = json.decodeFromString<SavedLocation>(payloadJson)
      val app = appContext.applicationContext as? NodeApp ?: return@launch

      // Update geofence
      app.locationManager.updateGeofence(location)
      LocationPersistence.addLocation(appContext, location)
    } catch (e: Throwable) {
      Log.e("NodeRuntime", "Failed to handle location.updated", e)
    }
  }
}

private fun handleLocationDeleted(payloadJson: String?) {
  if (payloadJson.isNullOrBlank()) return
  scope.launch(Dispatchers.IO) {
    try {
      val payload = json.parseToJsonElement(payloadJson).asObjectOrNull()
      val locationId = (payload?.get("locationId") as? JsonPrimitive)?.content ?: return@launch
      val app = appContext.applicationContext as? NodeApp ?: return@launch

      // Remove geofence
      app.locationManager.unregisterGeofence(locationId)
      LocationPersistence.removeLocation(appContext, locationId)
    } catch (e: Throwable) {
      Log.e("NodeRuntime", "Failed to handle location.deleted", e)
    }
  }
}

private fun handleTaskTriggered(payloadJson: String?) {
  if (payloadJson.isNullOrBlank()) return
  // Show notification for triggered location-based task
  try {
    val payload = json.parseToJsonElement(payloadJson).asObjectOrNull()
    val task = payload?.get("task").asObjectOrNull()
    val text = (task?.get("text") as? JsonPrimitive)?.content ?: "Task triggered"
    val triggerType = (payload?.get("triggerType") as? JsonPrimitive)?.content ?: "enter"

    showTaskNotification(text, triggerType)
  } catch (e: Throwable) {
    Log.e("NodeRuntime", "Failed to handle task.triggered", e)
  }
}

private fun showTaskNotification(text: String, triggerType: String) {
  // TODO: Implement notification using NotificationManager
  Log.i("NodeRuntime", "Task triggered ($triggerType): $text")
}
```

---

## 3. ElevenLabs TTS for Real-Time Conversation

### Gateway Configuration

ElevenLabs TTS is configured in the gateway's config file:

```yaml
tts:
  auto: always # Enable auto-TTS for all responses
  provider: elevenlabs
  elevenlabs:
    apiKey: "your-elevenlabs-api-key"
    voiceId: "your-voice-id" # Your private voice
    modelId: "eleven_turbo_v2_5" # Fast model for real-time
    voiceSettings:
      stability: 0.5
      similarityBoost: 0.75
      style: 0.0
      useSpeakerBoost: true
      speed: 1.0
```

### Android Integration

The Android app already handles TTS via the `TalkModeManager`. To enable:

1. **Enable Talk Mode in Settings**:

```kotlin
// In NodeRuntime
fun setTalkEnabled(value: Boolean) {
  prefs.setTalkEnabled(value)
}
```

2. **TalkModeManager handles**:
   - Recording user speech
   - Sending to gateway for STT
   - Receiving AI response
   - Playing TTS audio

3. **Audio Playback** happens via the `TalkModeManager.isSpeaking` state flow.

---

## 4. Create Private Voice for Self-Recognition

### Why Create Your Own Voice

When the pendant picks up the AI's spoken response (from speakers), the system
needs to recognize it as "self" and not transcribe it as user speech. Creating
a private ElevenLabs voice allows:

1. **Voice fingerprinting** - Match the TTS output to a known "self" profile
2. **Echo cancellation** - Skip transcription when AI voice is detected
3. **Conversation flow** - Don't trigger on AI's own speech

### Steps to Create Private Voice

1. **Go to ElevenLabs Voice Lab**: https://elevenlabs.io/app/voice-lab

2. **Click "Add Generative or Cloned Voice" → "Instant Voice Cloning"**

3. **Record or upload samples** of the desired AI voice (3-10 samples recommended)

4. **Name the voice** (e.g., "OpenClaw Assistant")

5. **Copy the Voice ID** for configuration

### Configure in Gateway

```yaml
tts:
  provider: elevenlabs
  elevenlabs:
    voiceId: "YOUR_PRIVATE_VOICE_ID"
```

### Create Voice Profile for Self-Recognition

In the pendant plugin, add a system voice profile:

```typescript
// On gateway startup or when TTS is configured
const SYSTEM_VOICE_PROFILE_ID = "system_tts_voice";

// When TTS is used, add the voice embedding to the system profile
// This allows the speaker diarization to recognize AI speech
async function registerSystemVoiceProfile(embedding: VoiceEmbedding) {
  await speakerDiarizer.createProfile(embedding, "OpenClaw Assistant", {
    sessionKey: "system",
    conversationContext: "AI TTS output",
  });
}
```

### Android Echo Detection

In the pendant audio callback, skip transcription when TTS is playing:

```kotlin
// In NodeRuntime.handlePendantStartStream
pendant.setAudioCallback { pcmData ->
  // Skip if TTS is currently playing (echo)
  if (talkMode.isSpeaking.value) {
    return@setAudioCallback
  }

  // Send audio data...
  scope.launch {
    nodeSession.sendNodeEvent(
      event = "pendant.audio",
      payloadJson = buildJsonObject {
        put("audio", JsonPrimitive(base64))
        put("sampleRate", JsonPrimitive(sampleRate))
        put("isSpeaking", JsonPrimitive(false))  // Not TTS playback
      }.toString()
    )
  }
}
```

---

## Complete Wiring Checklist

### NodeApp.kt

- [ ] Initialize `LocationManager`
- [ ] Set `GeofenceBroadcastReceiver.locationManager`
- [ ] Handle pending re-registration from boot

### NodeRuntime.kt

- [ ] Add `scopes: listOf("operator.admin")` to operator connect options
- [ ] Call `setupGeofenceCallback()` during init
- [ ] Add handlers for `pendant.location.saved/updated/deleted`
- [ ] Add handler for `pendant.task.triggered`
- [ ] Add TTS echo detection in pendant audio callback

### GatewayConnectOptions.kt (or data class)

- [ ] Ensure `scopes` field is a `List<String>`

### AndroidManifest.xml

- [ ] `ACCESS_FINE_LOCATION` permission
- [ ] `ACCESS_BACKGROUND_LOCATION` permission
- [ ] `RECEIVE_BOOT_COMPLETED` permission
- [ ] `GeofenceBroadcastReceiver` registered
- [ ] `BootReceiver` registered with intent filter

### build.gradle.kts

- [ ] `com.google.android.gms:play-services-location:21.3.0`

---

## Testing

### Test Admin Access

```bash
# In Android app, send a message that requires admin
# Example: "Show me the config"
# Should succeed with admin scope, fail without
```

### Test Geofencing

1. Save a location: "Save this as my test location"
2. Check logcat: `adb logcat | grep LocationManager`
3. Use Android Emulator → Extended Controls → Location to move
4. Verify geofence trigger in logcat

### Test TTS

1. Enable Talk Mode in app settings
2. Send a message via pendant
3. Verify audio response plays
4. Check that AI's own speech isn't re-transcribed

---

## Troubleshooting

### Geofences Not Triggering

1. Check background location permission (Android 10+)
2. Ensure battery saver is off
3. Verify radius is ≥ 100m (smaller may be unreliable)
4. Check Play Services is installed

### TTS Not Playing

1. Verify ElevenLabs API key in config
2. Check `talkEnabled` preference is true
3. Ensure audio output volume is up
4. Check logcat for TTS errors

### Admin Methods Failing

1. Verify `operator.admin` scope in connect options
2. Check WebSocket is connected (`operatorConnected == true`)
3. Look for "missing scope" errors in logcat
