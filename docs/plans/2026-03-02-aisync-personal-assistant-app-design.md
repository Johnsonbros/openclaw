# AiSync Personal Assistant App — Design Document

**Date:** 2026-03-02
**Author:** Nate Johnson + Claude
**Status:** Approved
**Target:** AiSync Android app (aisync flavor) for personal AI assistant users

---

## 1. Overview

Redesign the AiSync Android app from a developer-oriented OpenClaw node client into a consumer-facing personal AI assistant app. The app serves Free ($0), Personal Standard ($29), and Personal Pro ($99) tier users. Service business features come later.

**Core philosophy:** The canvas IS the product. The AI agent renders everything the user needs directly on a full-screen web canvas. The native app is a thin shell — 3 floating buttons, a connection indicator, and voice interaction. No chat-first UI. No tab bar. Just a window into your AI.

---

## 2. Target Users

| Tier | Price | Key Features |
|------|-------|-------------|
| Free | $0/mo | Morning/nightly check-ins, search, weather, chat, 500K tokens/day |
| Personal Standard | $29/mo | Dedicated number, vault access, call screening, unlimited tokens |
| Personal Pro | $99/mo | Unlimited voice, smart home, automations, local Mac option |

**User profile:** Non-technical individuals who want an AI assistant that remembers them and gets smarter over time. Not developers. Setup should require zero technical knowledge.

---

## 3. Home Screen: Canvas-First Layout

The home screen is a full-screen WebView canvas. The agent renders everything here — morning briefings, weather, reminders, search results, lists, whatever the user asks for.

```
+-----------------------------------+
|           STATUS BAR              |
|                                   |
|                                   |
|                                   |
|      FULL-SCREEN CANVAS           |
|      (Agent renders everything)   |
|                                   |
|                                   |
|                                   |
|                                   |
|   [gear]   [  mic  ]   [grid]    |  <- 3 floating buttons
|         * Connected               |  <- status pill
+-----------------------------------+
```

### 3.1 Floating Buttons

Three buttons float over the canvas at the bottom, semi-transparent background so canvas content shows through:

1. **Settings** (left, gear icon) — opens settings sheet as modal overlay
2. **Voice** (center, larger, mic icon) — primary interaction method
   - **Tap** = walkie-talkie mode (push-to-talk, release to send)
   - **Long-press** = voice call mode (continuous conversation until hung up)
3. **More** (right, grid icon) — opens bottom sheet with secondary screens

### 3.2 Status Indicator

Small pill below the 3 buttons:
- Green dot + "Connected" when gateway is reachable
- Red dot + "Offline" when disconnected
- Amber dot + "Connecting..." during connection attempts

### 3.3 Canvas Content (Agent-Driven)

The agent decides what to show. Examples:
- **6am:** Morning briefing — weather, today's reminders, news highlights
- **9pm:** Nightly debrief — what happened today, tomorrow preview
- **User asks "what's the weather":** Agent renders a weather card on canvas
- **User asks "make a packing list":** Agent renders an interactive checklist
- **User asks "what did we talk about yesterday":** Agent renders conversation summary
- **Idle state:** Agent shows a clean dashboard with time, weather, and any pending reminders

---

## 4. Voice Interaction

### 4.1 Walkie-Talkie Mode (Tap)

- User taps mic button
- Small pulsing dot appears near the button (AiSync blue #0F3460)
- Canvas stays 100% visible — no overlay, no sheet
- Dot pulses with audio input level
- User releases = audio sent to agent
- Dot changes to "thinking" state (subtle shimmer/pulse)
- Agent responds via TTS, dot briefly changes color
- Dot disappears when interaction complete

### 4.2 Voice Call Mode (Long-Press)

- User long-presses mic button
- Small floating pill appears: "On call with [agent name]"
- Continuous back-and-forth conversation — no need to re-tap
- Canvas stays visible — agent can update it in real-time during conversation
- Tap mic button or pill again to hang up
- Pill disappears

### 4.3 Visual Indicators

Both modes use minimal floating indicators that don't obscure the canvas:
- **Listening:** Pulsing blue dot with waveform
- **Thinking:** Shimmer/breathe animation (like typing indicator)
- **Speaking:** Animated rings expanding outward
- All indicators are small (24-32dp) and positioned near the mic button

---

## 5. "More" Bottom Sheet

Tapping the grid button opens a bottom sheet with 5 card tiles:

| Card | Icon | Description | Tier |
|------|------|-------------|------|
| **Chat** | Speech bubble | Text-based conversation for when you can't talk | All |
| **Maps** | Pin/globe | Location, places, geofencing, location-based reminders | All |
| **Pendant** | Bluetooth | BLE pendant pairing and status | All |
| **Vault** | Brain/file | Browse what your AI knows — memory, logs, profiles | Standard+ |
| **Automations** | Lightning | Custom workflows and triggers | Pro |

### 5.1 Bottom Sheet Design

- Springs up from bottom, covers ~60% of screen
- Drag handle at top to expand/collapse
- Cards are in a 2-column grid (Chat + Maps top row, Pendant + Vault second row, Automations centered bottom)
- Each card: icon, title, brief subtitle, gradient accent matching AiSync brand
- Locked cards (tier-gated) show lock icon + "Upgrade to Standard" / "Upgrade to Pro"
- Tapping a card navigates to that screen (full-screen, back button to return to canvas)

### 5.2 Maps Screen

Native Google Maps component with agent-controlled data layer:
- **Saved places** — pins the agent knows about (home, work, grocery store, gym)
- **Geofences** — circular regions that trigger reminders or automations
- **Location reminders** — "remind me when I get to the store: buy milk"
- **Real-time location** — current position
- Agent adds/removes/updates pins and geofences via invoke commands
- User can also manually add places by long-pressing the map

### 5.3 Chat Screen

Text-based conversation interface for when voice isn't practical:
- Message bubbles (user right, agent left)
- Text input + send button
- Attachment support (images)
- Streaming response text
- Thinking level selector
- This is the existing ChatSheet, reskinned for AiSync dark theme

### 5.4 Pendant Screen

BLE pendant pairing and management:
- Scan for devices
- Connect/disconnect
- Audio streaming status
- Battery level (if available)
- Same functionality as current PendantSetupScreen, reskinned

### 5.5 Vault Screen

Browse the AI's Obsidian vault via canvas:
- Agent renders vault contents on the canvas WebView
- User can browse daily logs, customer profiles, decision history
- Search functionality
- Edit capability for correcting AI knowledge

### 5.6 Automations Screen

Custom workflows (Pro tier):
- List of active automations
- Create new automation (time-based, location-based, event-based)
- Agent helps create automations via conversation

---

## 6. Onboarding

### 6.1 Pairing Code Flow (Primary)

For customers onboarded by AiSync team:

```
+-----------------------------------+
|                                   |
|     [AiSync gear+van logo]        |
|                                   |
|     Your AI Assistant             |
|                                   |
|   Enter your setup code:          |
|   +---+---+---+---+---+---+      |
|   | A | 3 | X | 7 | K | 9 |      |
|   +---+---+---+---+---+---+      |
|                                   |
|   [  Connect to My AI  ]         |
|                                   |
|   Your code was sent by email     |
|   during onboarding.              |
|                                   |
|   --- or ---                      |
|                                   |
|   [ Create Free Account ]         |
|                                   |
+-----------------------------------+
```

The 6-character pairing code resolves to gateway host + auth token + TLS config. Generated by AiSync during the 30-min onboarding call.

### 6.2 Free Tier Self-Serve (Secondary)

"Create Free Account" flow:
- Enter name + email
- Backend provisions an agent container
- Sends pairing code to email
- User enters code in app
- Connected

### 6.3 Technical Setup (Hidden)

A small "Technical Setup" link at the bottom of the onboarding screen for:
- QR code scanning
- Manual host/port/token/TLS entry
- Used by AiSync team for debugging, not customers

### 6.4 Post-Connect

After successful connection:
- Brief permission request (mic, notifications, location)
- Single screen, toggle switches, "Enable recommended" button
- Then straight to the canvas home screen
- Agent renders a welcome message: "Hey [name], I'm your AI assistant. Ask me anything or just say hi."

---

## 7. Color System (Dark Theme Only)

Based on AiSync brand + ZEKEapp design system:

```
Background:
  base:      #0F172A   (deep navy)
  surface1:  #1E293B   (cards, sheets)
  surface2:  #334155   (elevated elements)
  surface3:  #475569   (top-level surfaces)

Brand:
  primary:   #0F3460   (AiSync brand blue)
  accent:    #4FC3F7   (bright cyan, interactive)
  highlight: #6366F1   (indigo, from ZEKEapp)

Text:
  primary:   #F1F5F9
  secondary: #94A3B8
  tertiary:  #64748B

Status:
  success:   #10B981   (green)
  warning:   #F59E0B   (amber)
  danger:    #EF4444   (red)
  info:      #4FC3F7   (cyan)

Floating buttons:
  background: #1E293B at 85% opacity (glass effect)
  border:     #334155
  active:     #0F3460
```

Dark theme only for v1. Reduces glare for outdoor use, saves battery on AMOLED, and gives a premium feel.

### 7.1 Typography

Manrope font family (matches ZEKEapp):
- Display: 34sp bold
- Title: 24sp semibold
- Headline: 16sp semibold
- Body: 15sp medium
- Callout: 14sp medium
- Caption: 12sp medium

### 7.2 Component Style

- Border radius: 16dp standard, 12dp secondary, 999dp pills
- Button height: 52dp
- Floating button size: 56dp (side), 64dp (center mic)
- Cards: surface1 background, 1dp border in surface2
- Bottom sheet: surface1 background, rounded top corners 24dp
- Status pill: 28dp height, rounded full, surface1 background

---

## 8. What We're Building vs. What Exists

### Reuse from current OpenClaw app:
- WebView canvas infrastructure (CanvasController, CanvasScreen)
- Gateway connection + WebSocket protocol
- BLE pendant manager (PendantBleManager)
- Voice/talk mode engine (TalkModeManager)
- Agent notification system (AgentNotificationManager)
- Chat controller (for Chat screen in More sheet)
- Device identity + pairing (Ed25519)

### New for AiSync flavor:
- Canvas-first home screen layout (replace PostOnboardingTabs)
- 3 floating buttons overlay
- Voice interaction indicators (pulsing dot, call pill)
- Bottom sheet "More" menu with card grid
- Maps screen (native Google Maps + agent control)
- Pairing code onboarding flow (replace current 4-step)
- Dark theme color system
- AiSync branding throughout

### NOT building (deferred to service business version):
- Business call log
- Customer database
- Scheduling/calendar management
- CRM integration
- Invoice/payment management
- Review management
- Blog/website management
- Weekly business reports

---

## 9. Implementation Notes

### 9.1 Pairing Code Backend

The pairing code system needs a lightweight lookup service:
- AiSync team generates a 6-char code that maps to {host, port, tls, token}
- Code stored in a simple key-value store (could be a JSON file on the gateway, or a simple API)
- App sends code to a resolver endpoint, gets back connection config
- Code expires after 48 hours or first use

### 9.2 Canvas Default Content

The agent needs a default "home" canvas that renders when the app first connects:
- This is an A2UI (Agent-to-UI) capability already in OpenClaw
- The agent pushes HTML/JS to the canvas WebView
- Default content: greeting + time + weather widget + pending reminders
- Agent updates canvas in response to voice/chat commands

### 9.3 Maps Integration

New invoke commands needed in the gateway:
- `location.places.list` — get saved places
- `location.places.add` — save a new place
- `location.geofence.add` — create a geofence
- `location.geofence.list` — list active geofences
- `location.reminders.list` — location-based reminders

The Maps screen is a native Compose component (Google Maps SDK) that reads data from these commands.

### 9.4 Voice Indicator Components

New Compose components:
- `VoiceIndicatorDot` — small pulsing circle, animates with audio level
- `VoiceCallPill` — floating "On call" indicator
- `ThinkingShimmer` — subtle animation during agent processing
- All use `animateFloatAsState` with spring physics

---

## 10. File Changes Summary

### New files (aisync flavor):
- `apps/android/app/src/aisync/.../ui/AiSyncHomeScreen.kt` — canvas + floating buttons
- `apps/android/app/src/aisync/.../ui/AiSyncOnboarding.kt` — pairing code flow
- `apps/android/app/src/aisync/.../ui/MoreSheet.kt` — bottom sheet with cards
- `apps/android/app/src/aisync/.../ui/MapsScreen.kt` — native map + agent data
- `apps/android/app/src/aisync/.../ui/VoiceIndicators.kt` — floating dot/pill/shimmer
- `apps/android/app/src/aisync/.../ui/AiSyncTheme.kt` — dark theme color system
- `apps/android/app/src/aisync/.../PairingCodeResolver.kt` — code -> config lookup

### Modified files:
- `apps/android/app/src/main/.../MainActivity.kt` — route to AiSync home for aisync flavor
- `apps/android/app/src/main/.../NodeRuntime.kt` — pairing code connection method
- `apps/android/app/build.gradle.kts` — Google Maps SDK dependency for aisync flavor

### Unchanged:
- All existing OpenClaw flavor screens (PostOnboardingTabs, OnboardingFlow, etc.)
- Gateway protocol, canvas controller, BLE manager, voice engine
- OpenClaw flavor continues to work exactly as before

---

## 11. Success Criteria

1. Beta user opens app, enters 6-char code, connected in under 30 seconds
2. Canvas shows personalized greeting within 5 seconds of connection
3. Tap mic, say "what's the weather", get voice response — all without leaving home screen
4. Long-press mic, have a 2-minute conversation — canvas updates in real-time
5. Maps screen shows saved places and active geofences
6. Zero mentions of "gateway", "node", "WebSocket", or "TLS" in the customer-facing UI
7. App looks and feels like a premium consumer product, not a developer tool
