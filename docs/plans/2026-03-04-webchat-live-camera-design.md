# WebChat Live Camera — Always-On Video with Auto-Snap on Send

**Date:** 2026-03-04
**Status:** Approved

## Summary

Add a live camera preview to the WebChat chat view with automatic frame capture on every message send. ZEKE sees the user's face with every chat message — like a video call where the AI has visual context.

## Architecture

### Live Camera Preview

A small floating `<video>` element (picture-in-picture style) in the WebChat chat view showing the user's face. The camera stream stays open as long as the user is on the chat page. Positioned bottom-right, circular crop, ~120px diameter.

- Uses `navigator.mediaDevices.getUserMedia({ video: true, audio: false })`
- Stream acquired once on page load (after user grants permission)
- Toggle button to enable/disable the camera
- Permission-denied state with retry button

### Auto-Snap on Send

When the user sends a chat message:

1. Capture a frame from the live `<video>` element onto an offscreen `<canvas>`
2. Encode as JPEG (quality ~0.85, max width 800px for token efficiency)
3. Attach as an image block in the message content array alongside the text
4. ZEKE receives both the text and the user's face in every message

### Key Design Decisions

- **No node invoke**: Frame capture happens entirely client-side in the UI. The image is attached directly to the chat message via the existing image attachment API (`source.type: "base64"`). The node webcam feature (`camera.snap`) remains for remote/proactive use cases (e.g., Telegram).
- **No server changes**: The gateway already supports image attachments in chat messages.
- **No audio**: Camera only, no microphone streaming.
- **No periodic capture**: Frames captured only on message send.

## Components

### 1. Camera Preview Widget

New Lit component or addition to existing chat view:

- `<video>` element with `srcObject` set to the camera stream
- Circular CSS clip, positioned fixed bottom-right of chat area
- Green dot indicator when active
- Camera-off icon when disabled
- First-use: browser permission prompt

### 2. Chat Send Integration

Modify the chat message send flow:

- Before sending, check if camera stream is active
- If active, capture frame via canvas → toBlob → base64
- Add image block to message content array
- Send message with both text + image

### 3. Visual States

- **Camera active**: Live preview visible, green indicator
- **Camera off**: Small camera-off icon, clickable to re-enable
- **Permission denied**: Camera icon with warning, click to retry
- **No camera**: Icon hidden entirely

## Out of Scope

- Microphone/audio streaming
- Periodic/continuous frame capture
- Server-side changes
- Changes to the node webcam protocol
- Video recording during chat
