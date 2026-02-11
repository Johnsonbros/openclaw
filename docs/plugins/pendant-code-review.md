---
summary: "Pendant plugin code review: issues, missing wiring, and Android developer notes"
read_when:
  - Debugging pendant integration issues
  - Working on Android pendant integration
  - Before testing pendant features
title: "Pendant Code Review"
---

# Pendant Plugin Code Review

This document covers issues found during code review, missing wiring between
components, and notes for Android development (Zeke).

## Issues Summary

### Critical (Must Fix Before Testing)

| #   | Issue                                        | File                             | Impact                                  |
| --- | -------------------------------------------- | -------------------------------- | --------------------------------------- |
| 1   | Gateway STT not implemented                  | `index.ts:1189-1197`             | STT returns null for "gateway" provider |
| 2   | Speaker diarization uses random embeddings   | `speaker-diarization.ts:186-191` | Voice matching won't work               |
| 3   | Missing WebSocket bridge for geofence events | Android                          | Events never reach gateway              |
| 4   | LocationManager not initialized in app       | Android                          | No geofencing                           |

### Medium (Should Fix)

| #   | Issue                               | File               | Impact                                 |
| --- | ----------------------------------- | ------------------ | -------------------------------------- |
| 5   | No location ID resolution for tasks | `index.ts:418-426` | Location tasks missing IDs             |
| 6   | Person location tasks not wired     | `tasks.ts`         | "Near John's house" won't work         |
| 7   | No Android-side location saving     | Android            | Locations not persisted to SharedPrefs |

### Low (Nice to Have)

| #   | Issue                                       | File               | Impact               |
| --- | ------------------------------------------- | ------------------ | -------------------- |
| 8   | CLI commands are stubs                      | `index.ts:769-793` | CLI not functional   |
| 9   | No error handling for missing workspace dir | `index.ts:489`     | Memory hook may fail |

---

## Detailed Issues

### Issue 1: Gateway STT Not Implemented

**File:** `extensions/pendant/index.ts:1189-1197`

**Problem:** The `transcribeWithGateway` function is a placeholder that always returns null.

```typescript
async function transcribeWithGateway(pcmData: Buffer, sampleRate: number): Promise<string | null> {
  console.log(`[Pendant] Gateway STT: would transcribe ${pcmData.length} bytes at ${sampleRate}Hz`);
  return null; // <-- Always returns null
}
```

**Fix:** Implement gateway STT by calling the gateway's audio transcription service.

```typescript
async function transcribeWithGateway(
  pcmData: Buffer,
  sampleRate: number,
  api: OpenClawPluginApi,
): Promise<string | null> {
  try {
    const wavData = pcmToWav(pcmData, sampleRate);
    const result = await api.runtime.stt?.transcribe(wavData, {
      format: "wav",
      language: "en",
    });
    return result?.text || null;
  } catch (error) {
    console.error("[Pendant] Gateway STT error:", error);
    return null;
  }
}
```

---

### Issue 2: Speaker Diarization Uses Random Embeddings

**File:** `extensions/pendant/speaker-diarization.ts:186-191`

**Problem:** The embedding generation returns random values, so speaker matching
will never work reliably.

```typescript
private async generateEmbedding(
  pcmData: Buffer,
  sampleRate: number
): Promise<VoiceEmbedding> {
  // Return random embedding for now (256 dimensions)
  const embedding = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    embedding[i] = Math.random() * 2 - 1;  // <-- Random!
  }
  return embedding;
}
```

**Fix Options:**

1. **Use ONNX model** - Bundle a speaker embedding model (e.g., ECAPA-TDNN)
2. **Use cloud API** - Call SpeechBrain/Pyannote API
3. **Disable until implemented** - Set `enableSpeakerDiarization: false` by default

---

### Issue 3: Missing WebSocket Bridge for Geofence Events

**Files:**

- `apps/android/.../location/GeofenceBroadcastReceiver.kt`
- `apps/android/.../location/LocationManager.kt`

**Problem:** When a geofence is triggered, the callback system calls
`callback?.onGeofenceEvent(event)`, but nothing actually sends this to the
gateway via WebSocket.

**Current flow (broken):**

```
Geofence triggered → BroadcastReceiver → LocationManager → callback → ???
```

**Required flow:**

```
Geofence triggered → BroadcastReceiver → LocationManager → callback →
  → WebSocket → Gateway → pendant.geofence.enter/exit event
```

**Fix (for Zeke):** In `NodeApp` or `PendantService`, set up the callback:

```kotlin
// In NodeApp.kt or where you initialize LocationManager
locationManager.setCallback(object : GeofenceCallback {
  override fun onGeofenceEvent(event: GeofenceEvent) {
    // Send to gateway via WebSocket
    val payload = Json.encodeToString(mapOf(
      "locationId" to event.locationId,
      "locationName" to event.locationName,
      "eventType" to event.eventType.name.lowercase()
    ))

    val eventName = when (event.eventType) {
      GeofenceEventType.ENTER -> "pendant.geofence.enter"
      GeofenceEventType.EXIT -> "pendant.geofence.exit"
      GeofenceEventType.DWELL -> "pendant.geofence.enter"  // Treat dwell as enter
    }

    gatewayWebSocket.sendEvent(eventName, payload)
  }
})
```

---

### Issue 4: LocationManager Not Initialized

**Problem:** `LocationManager` is defined but not created/initialized in the app.
The `GeofenceBroadcastReceiver.locationManager` static field is never set.

**Fix (for Zeke):** Initialize in `NodeApp.onCreate()`:

```kotlin
class NodeApp : Application() {
  lateinit var locationManager: LocationManager
    private set

  override fun onCreate() {
    super.onCreate()

    // Initialize LocationManager
    locationManager = LocationManager(this, CoroutineScope(Dispatchers.Default))
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

---

### Issue 5: Location ID Resolution Missing for Tasks

**File:** `extensions/pendant/index.ts:418-426`

**Problem:** When creating a location-based task from voice, the `locationId` is
not resolved from the location name.

```typescript
case "task_create":
case "task_create_location": {
  const task = await taskManager.createTask({
    // ...
    locationTrigger: intent.locationTrigger
      ? {
          triggerOn: intent.locationTrigger.triggerOn,
          // Location ID will be resolved by AI or location manager  // <-- Not done!
        }
      : undefined,
  });
```

**Fix:** Add location resolution:

```typescript
let locationTrigger: LocationTrigger | undefined;
if (intent.locationTrigger) {
  locationTrigger = {
    triggerOn: intent.locationTrigger.triggerOn,
  };

  // Resolve location name to ID
  if (intent.locationTrigger.locationName) {
    const location = await locationManager.findLocationByName(intent.locationTrigger.locationName);
    if (location) {
      locationTrigger.locationId = location.id;
    }
  }

  // Resolve group name to ID
  if (intent.locationTrigger.groupName) {
    const group = await locationManager.findGroupByName(intent.locationTrigger.groupName);
    if (group) {
      locationTrigger.groupId = group.id;
    }
  }

  // Resolve person location
  if (intent.locationTrigger.personName) {
    const person = await peopleManager.findProfileByName(intent.locationTrigger.personName);
    if (person) {
      locationTrigger.personLocationTag = `${person.id}:home`;
    }
  }
}
```

---

### Issue 6: Person Location Tasks Not Wired

**File:** `extensions/pendant/tasks.ts`

**Problem:** The `LocationTrigger` interface has `personLocationTag` but
`getTasksForLocation` doesn't check it.

**Fix:** Update `getTasksForLocation`:

```typescript
async getTasksForLocation(
  locationId?: string,
  groupId?: string,
  triggerType?: "enter" | "exit",
  personLocationTag?: string  // Add parameter
): Promise<Task[]> {
  await this.ensureLoaded();

  return this.tasks.filter((task) => {
    if (task.completed || task.triggered || !task.locationTrigger) {
      return false;
    }

    const trigger = task.locationTrigger;

    // ... existing location/group checks ...

    // Match by person location tag
    if (personLocationTag && trigger.personLocationTag === personLocationTag) {
      if (!triggerType || trigger.triggerOn === triggerType || trigger.triggerOn === "both") {
        return true;
      }
    }

    return false;
  });
}
```

---

### Issue 7: Android Location Not Persisted

**Problem:** When the backend emits `pendant.location.saved`, Android needs to:

1. Register the geofence
2. Persist to SharedPreferences for boot recovery

**Fix (for Zeke):** Handle the event from gateway:

```kotlin
// When receiving pendant.location.saved from WebSocket
fun handleLocationSaved(payload: String) {
  val location = Json.decodeFromString<SavedLocation>(payload)

  scope.launch {
    // Register geofence
    val success = locationManager.registerGeofence(location)

    if (success) {
      // Persist for boot recovery
      LocationPersistence.addLocation(context, location)
    }
  }
}

// When receiving pendant.location.deleted from WebSocket
fun handleLocationDeleted(locationId: String) {
  scope.launch {
    locationManager.unregisterGeofence(locationId)
    LocationPersistence.removeLocation(context, locationId)
  }
}
```

---

## Missing Wiring Diagram

```
Backend (TypeScript)                    Android (Kotlin)
===================                     ================

pendant.audio event ←──────────────── PendantService sends audio
        │
        ▼
   VAD check
        │
        ▼
   STT transcription ←───── ISSUE #1: Gateway STT not implemented
        │
        ▼
   Speaker diarization ←─── ISSUE #2: Random embeddings
        │
        ▼
   Intent classification
        │
        ▼
   Task creation
        │ (if location-based)
        ▼
   Emit pendant.location.saved ────▶ ??? ←── ISSUE #7: Not handled
        │
        ▼
   Emit pendant.task.created ──────▶ ??? ←── Need to register geofence


Android → Backend (geofence events):

Geofence triggered
        │
        ▼
GeofenceBroadcastReceiver
        │
        ▼
LocationManager.handleGeofenceTransition
        │
        ▼
callback.onGeofenceEvent ──────────▶ ??? ←── ISSUE #3: Not sent to gateway
        │ (should be)
        ▼
pendant.geofence.enter/exit event
        │
        ▼
Check tasks for location
        │
        ▼
Emit pendant.task.triggered
```

---

## For Zeke (Android Developer)

### Files You Need to Modify

1. **`NodeApp.kt`** or wherever app initialization happens:
   - Initialize `LocationManager`
   - Set `GeofenceBroadcastReceiver.locationManager`
   - Set up `GeofenceCallback` to send events to gateway
   - Handle pending re-registration from boot

2. **WebSocket handler** (wherever you process gateway events):
   - Handle `pendant.location.saved` → register geofence + persist
   - Handle `pendant.location.updated` → update geofence
   - Handle `pendant.location.deleted` → unregister geofence + remove from persistence

3. **`PendantService.kt`**:
   - Add method to send geofence events to gateway

### WebSocket Events to Send

| Event                    | When                 | Payload                    |
| ------------------------ | -------------------- | -------------------------- |
| `pendant.geofence.enter` | User enters geofence | `{ locationId, groupId? }` |
| `pendant.geofence.exit`  | User exits geofence  | `{ locationId, groupId? }` |

### WebSocket Events to Handle

| Event                      | Action                                       |
| -------------------------- | -------------------------------------------- |
| `pendant.location.saved`   | Register geofence, persist to SharedPrefs    |
| `pendant.location.updated` | Update geofence, update SharedPrefs          |
| `pendant.location.deleted` | Unregister geofence, remove from SharedPrefs |

### Permission Flow

1. Check `ACCESS_FINE_LOCATION` first
2. If granted, request `ACCESS_BACKGROUND_LOCATION` (Android 10+)
3. Show rationale explaining why background location is needed
4. Only register geofences after both are granted

```kotlin
fun requestLocationPermissions(activity: Activity) {
  val permissions = locationManager.getRequiredPermissions()

  when {
    // Already have all permissions
    locationManager.hasLocationPermissions() -> {
      onPermissionsGranted()
    }

    // Need to request
    else -> {
      // First request foreground, then background
      ActivityCompat.requestPermissions(activity, permissions, REQUEST_CODE)
    }
  }
}
```

### Testing Geofences

1. Use Android Studio's emulator location controls
2. Set a location near a saved geofence
3. Move the simulated location into/out of the geofence radius
4. Check logcat for `GeofenceReceiver` and `LocationManager` tags

```bash
adb logcat | grep -E "(GeofenceReceiver|LocationManager)"
```

---

## Test Checklist

Before testing the full system:

- [ ] **Gateway STT** - Either implement or use Deepgram/Whisper
- [ ] **Speaker diarization** - Disable or implement real embeddings
- [ ] **Android LocationManager** - Initialize in NodeApp
- [ ] **Geofence callback** - Wire to WebSocket
- [ ] **Location persistence** - Handle save/delete events
- [ ] **Permissions** - Test permission flow on Android 10+

### Manual Test Phrases

After fixing issues, test with:

1. "Save this location as home" (requires current location)
2. "Create a task to buy milk"
3. "Remind me to call John when I get home"
4. "What's on my list?"
5. "Mark the first task as done"

---

---

## TypeScript API Mismatches

The pendant plugin code has API mismatches with the actual OpenClaw plugin SDK.
These need to be fixed before compilation:

### Missing Exports

| Expected              | Status        | Fix                           |
| --------------------- | ------------- | ----------------------------- |
| `PluginConfigContext` | Not exported  | Use `any` or find actual type |
| `api.runtime.storage` | Doesn't exist | Check actual storage API      |
| `api.runtime.events`  | Doesn't exist | Check actual events API       |
| `api.registerEvent()` | Doesn't exist | Find event registration API   |
| `api.runtime.nodes`   | Doesn't exist | Check nodes API               |

### Tool Definition Issues

Tools need a `label` property in addition to `name` and `description`:

```typescript
// Before (incorrect)
{
  name: "voice_profile_list",
  description: "List all known voice profiles",
  // ...
}

// After (correct)
{
  name: "voice_profile_list",
  label: "List Voice Profiles",  // Add this
  description: "List all known voice profiles",
  // ...
}
```

### Action Items

1. Check actual plugin SDK types in `node_modules/openclaw/plugin-sdk`
2. Update imports and type references
3. Add `label` to all tool definitions
4. Use correct event/storage APIs

---

## Quick Fixes for Testing

If you need to test quickly without all features:

```json
// In plugin config - disable problematic features
{
  "sttProvider": "deepgram", // Use cloud STT instead of gateway
  "enableSpeakerDiarization": false, // Disable until implemented
  "enableSoftwareVAD": true, // Keep VAD for efficiency
  "autoSaveToMemory": true
}
```
