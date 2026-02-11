---
summary: "Pendant plugin bug and issue report from code analysis"
read_when:
  - Debugging pendant issues
  - Before testing pendant features
  - Fixing pendant bugs
title: "Pendant Bug Report"
---

# Pendant Plugin Code Analysis Report

## Summary

Analyzed 7 TypeScript files in `/extensions/pendant/` and 4 Kotlin files in
`/apps/android/.../location/`. The code is generally well-structured but contains
several issues ranging from potential bugs to missing error handling.

---

## Critical Issues (Must Fix)

### 1. Random Speaker Embeddings

**File:** `speaker-diarization.ts:186-191`
**Type:** Bug
**Status:** ⚠️ OPEN - Requires real ML model implementation
**Description:** `generateEmbedding` returns random data, causing incorrect speaker matching.
**Fix:** Replace with actual implementation or disable feature.

### 2. Regex Only Matches Capitalized Names

**File:** `intent-classifier.ts:326`
**Type:** Bug
**Status:** ✅ FIXED
**Description:** `/([A-Z][a-z]+)/` won't match "JOHN" or "john".
**Fix:** Changed to `/([A-Za-z]+)/i` and added `capitalizeFirstLetter()` helper for normalization.

### 3. Unsafe Non-Null Assertions

**Files:** `locations.ts:718-724`, `people-profiles.ts:575-579`
**Type:** Bug
**Status:** ✅ FIXED
**Description:** `updated!.id` can be null - updateLocation can return null.
**Fix:** Added null check before accessing updated properties.

### 4. Stale Voice Profile Count

**File:** `people-profiles.ts:960-962`
**Type:** Bug
**Status:** ✅ FIXED
**Description:** `voiceProfileIds.length + 1` uses old length after mutation.
**Fix:** Now refreshes profile after linking to get accurate count.

### 5. Array Access Without Bounds Check

**File:** `memory-hook.ts:327-329, 377-379`
**Type:** Bug
**Status:** ✅ FIXED
**Description:** `buffer.entries[0]` without checking length.
**Fix:** Added bounds check at start of `formatAsMarkdown()`.

---

## High Priority Issues

### TypeScript Files

| File               | Line    | Issue              | Description                                     |
| ------------------ | ------- | ------------------ | ----------------------------------------------- |
| index.ts           | 336     | Null check         | `storage?.get` return parsed without null check |
| index.ts           | 529     | Unsafe cast        | `ctx as { workspaceDir?: string }`              |
| index.ts           | 621-626 | Null access        | `speakerInfo?.speakerId` after assignment       |
| tasks.ts           | 61      | ✅ Fixed           | `includeTriggerred` → `includeTriggered`        |
| tasks.ts           | 599     | Missing validation | Tool has `required: []`                         |
| locations.ts       | 318-322 | Not awaited        | Group updates in loop without await             |
| people-profiles.ts | 719     | Missing required   | Only requires `tag`, not person ID              |

### Android Kotlin Files

| File                         | Line    | Issue      | Description                                |
| ---------------------------- | ------- | ---------- | ------------------------------------------ |
| BootReceiver.kt              | 74-80   | ✅ Fixed   | Added `goAsync()` for long-running work    |
| BootReceiver.kt              | 57      | ✅ Fixed   | Now creates scoped coroutine per broadcast |
| LocationManager.kt           | 160-168 | Security   | FLAG_MUTABLE could be concern              |
| GeofenceBroadcastReceiver.kt | 61-65   | Deprecated | `fromIntent()` deprecated                  |

---

## Medium Priority Issues

### Missing Tool Parameter Validation

Several tools have `required: []` but should require identifiers:

| File               | Tool                   | Should Require                   |
| ------------------ | ---------------------- | -------------------------------- |
| tasks.ts           | pendant_task_complete  | taskId OR position OR searchText |
| tasks.ts           | pendant_task_delete    | taskId OR position OR searchText |
| locations.ts       | location_update        | locationId OR locationName       |
| locations.ts       | location_delete        | locationId OR locationName       |
| locations.ts       | location_group_add     | groupId + locationId             |
| people-profiles.ts | person_profile_update  | personId OR personName           |
| people-profiles.ts | person_profile_get     | personId OR personName           |
| people-profiles.ts | person_location_remove | person ID + tag                  |
| people-profiles.ts | person_location_list   | person ID                        |

### Silent Failures

| File               | Line   | Issue                                |
| ------------------ | ------ | ------------------------------------ |
| tasks.ts           | 76-86  | loadTasks returns empty on error     |
| tasks.ts           | 91-100 | saveTasks doesn't propagate failure  |
| locations.ts       | 86-98  | loadLocations returns empty on error |
| people-profiles.ts | 88-102 | loadProfiles returns empty on error  |

---

## Security Issues

| File           | Line    | Risk   | Description                                |
| -------------- | ------- | ------ | ------------------------------------------ |
| memory-hook.ts | 283     | Medium | `memoryDir` not sanitized - path traversal |
| index.ts       | 538     | Low    | Audio payload not validated                |
| All storage    | Various | Low    | JSON parse without validation              |

---

## Dead/Unused Code

| File                   | Line    | Function                 | Notes                          |
| ---------------------- | ------- | ------------------------ | ------------------------------ |
| intent-classifier.ts   | 466-485 | parseTimeExpression      | Defined but results never used |
| speaker-diarization.ts | 372-389 | formatDiarizedTranscript | Exported but not used          |
| locations.ts           | 473-499 | findNearby               | No tool exposes it             |

---

## Placeholder Implementations

These are documented placeholders that need real implementations:

| File                   | Line      | Function              | Status                   |
| ---------------------- | --------- | --------------------- | ------------------------ |
| speaker-diarization.ts | 137-138   | detectSpeech          | Returns entire audio     |
| speaker-diarization.ts | 148-156   | segmentSpeakers       | Returns trivial segments |
| speaker-diarization.ts | 186-191   | generateEmbedding     | Returns random data      |
| index.ts               | 1189-1197 | transcribeWithGateway | Returns null             |

---

## Recommendations

### Critical

1. Replace `generateEmbedding` placeholder or disable speaker diarization
2. Fix non-null assertions - use proper null checks

### High Priority

3. Add input validation for event payloads and tool parameters
4. Fix typo `includeTriggerred` → `includeTriggered`
5. Add `goAsync()` to Android BootReceiver

### Medium Priority

6. Standardize error handling - currently mix of silent failures/throws
7. Add path sanitization for memory files
8. Use `FLAG_IMMUTABLE` for PendingIntent

### Low Priority

9. Fix case-sensitive name matching in intent patterns
10. Consider caching for speaker profile matching (O(n\*m) currently)
