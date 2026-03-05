# WebChat Live Camera — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a live camera preview to WebChat chat that auto-captures a frame on every message send, giving ZEKE visual context of the user.

**Architecture:** A persistent `getUserMedia` video stream rendered in a floating preview widget. On send, a canvas frame is captured, converted to a `ChatAttachment`, and injected into the existing attachment flow. No server changes needed.

**Tech Stack:** Lit (web components), Web MediaDevices API, Canvas API, existing ChatAttachment/sendChatMessage infrastructure.

---

### Task 1: Camera Stream Manager

Creates a singleton that manages the camera `MediaStream` lifecycle — open, close, and frame capture.

**Files:**
- Create: `ui/src/ui/webcam-stream.ts`
- Test: `ui/src/ui/webcam-stream.node.test.ts`

**Step 1: Write the failing test**

```typescript
// ui/src/ui/webcam-stream.node.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock navigator.mediaDevices
const mockStream = {
  getTracks: () => [{ stop: vi.fn() }],
  getVideoTracks: () => [{ getSettings: () => ({ width: 640, height: 480 }) }],
};

beforeEach(() => {
  globalThis.window = globalThis as unknown as Window & typeof globalThis;
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn().mockResolvedValue(mockStream) },
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WebcamStream", () => {
  it("openStream acquires camera and returns stream", async () => {
    const { openStream } = await import("./webcam-stream.ts");
    const stream = await openStream();
    expect(stream).toBe(mockStream);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      video: true,
      audio: false,
    });
  });

  it("closeStream stops all tracks", async () => {
    const { openStream, closeStream, getStream } = await import("./webcam-stream.ts");
    await openStream();
    closeStream();
    expect(getStream()).toBeNull();
  });

  it("isStreamActive returns correct state", async () => {
    const { openStream, closeStream, isStreamActive } = await import("./webcam-stream.ts");
    expect(isStreamActive()).toBe(false);
    await openStream();
    expect(isStreamActive()).toBe(true);
    closeStream();
    expect(isStreamActive()).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run ui/src/ui/webcam-stream.node.test.ts`
Expected: FAIL (module not found)

**Step 3: Write the implementation**

```typescript
// ui/src/ui/webcam-stream.ts
let currentStream: MediaStream | null = null;

export async function openStream(): Promise<MediaStream> {
  if (currentStream) {
    return currentStream;
  }
  currentStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: false,
  });
  return currentStream;
}

export function closeStream(): void {
  if (!currentStream) {
    return;
  }
  for (const track of currentStream.getTracks()) {
    track.stop();
  }
  currentStream = null;
}

export function getStream(): MediaStream | null {
  return currentStream;
}

export function isStreamActive(): boolean {
  return currentStream !== null;
}

/**
 * Capture a JPEG frame from the active stream.
 * Returns a data URL string or null if no stream is active.
 */
export async function captureFrame(opts?: {
  maxWidth?: number;
  quality?: number;
}): Promise<{ dataUrl: string; mimeType: string } | null> {
  if (!currentStream) {
    return null;
  }
  const maxWidth = opts?.maxWidth ?? 800;
  const quality = opts?.quality ?? 0.85;

  const track = currentStream.getVideoTracks()[0];
  const settings = track.getSettings();
  let w = settings.width ?? 640;
  let h = settings.height ?? 480;

  if (w > maxWidth) {
    const ratio = maxWidth / w;
    h = Math.round(h * ratio);
    w = maxWidth;
  }

  const video = document.createElement("video");
  video.srcObject = currentStream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  await new Promise((r) => requestAnimationFrame(r));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(video, 0, 0, w, h);
  video.pause();
  video.srcObject = null;

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) {
    return null;
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result as string));
    reader.addEventListener("error", () => reject(new Error("FileReader error")));
    reader.readAsDataURL(blob);
  });

  return { dataUrl, mimeType: "image/jpeg" };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run ui/src/ui/webcam-stream.node.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add ui/src/ui/webcam-stream.ts ui/src/ui/webcam-stream.node.test.ts
git commit -m "feat(webchat): add webcam stream manager with frame capture"
```

---

### Task 2: Camera Preview Widget

Add a floating camera preview `<video>` element to the chat compose area with a toggle button.

**Files:**
- Modify: `ui/src/ui/views/chat.ts` (lines 423-477, the chat-compose section)
- Modify: `ui/src/ui/app.ts` (add `cameraEnabled` state property)
- Modify: `ui/src/ui/app-render.ts` (pass camera props to renderChat)

**Step 1: Add state property to app.ts**

In `ui/src/ui/app.ts`, add after the `chatAttachments` state property:

```typescript
@state() cameraEnabled = false;
@state() cameraStream: MediaStream | null = null;
```

**Step 2: Add camera props to ChatRenderProps**

In `ui/src/ui/views/chat.ts`, add to the `ChatRenderProps` type (the props parameter of `renderChat`):

```typescript
cameraEnabled: boolean;
cameraStream: MediaStream | null;
onCameraToggle: () => void;
```

**Step 3: Add the camera preview and toggle to the chat compose template**

In `ui/src/ui/views/chat.ts`, inside the `<div class="chat-compose">` section (line 423), add the camera preview before the attachment preview:

```html
${props.cameraStream
  ? html`<div class="chat-camera-preview">
      <video
        ${ref((el) => {
          if (el && el instanceof HTMLVideoElement && el.srcObject !== props.cameraStream) {
            el.srcObject = props.cameraStream;
            el.play();
          }
        })}
        muted
        playsinline
        autoplay
      ></video>
    </div>`
  : nothing}
```

Add a camera toggle button in `chat-compose__actions` div, before the Stop/New session button:

```html
<button
  class="btn chat-camera-toggle ${props.cameraEnabled ? 'active' : ''}"
  title=${props.cameraEnabled ? "Turn off camera" : "Turn on camera"}
  @click=${props.onCameraToggle}
>
  ${props.cameraEnabled ? "📷" : "📷"}
</button>
```

**Step 4: Wire props in app-render.ts**

In the `renderChat()` call in `app-render.ts`, add the camera props:

```typescript
cameraEnabled: state.cameraEnabled,
cameraStream: state.cameraStream,
onCameraToggle: () => void toggleCamera(state),
```

**Step 5: Add toggleCamera function in app-chat.ts**

```typescript
import { openStream, closeStream, getStream } from "./webcam-stream.ts";

export async function toggleCamera(host: ChatHost) {
  if (host.cameraEnabled) {
    closeStream();
    host.cameraEnabled = false;
    host.cameraStream = null;
  } else {
    try {
      const stream = await openStream();
      host.cameraEnabled = true;
      host.cameraStream = stream;
    } catch {
      // Permission denied or no camera — stay off
      host.cameraEnabled = false;
      host.cameraStream = null;
    }
  }
}
```

**Step 6: Add CSS for camera preview**

The CSS file is `ui/src/ui/views/chat.ts` or a linked CSS file. Add styles:

```css
.chat-camera-preview {
  position: relative;
  width: 120px;
  height: 120px;
  border-radius: 50%;
  overflow: hidden;
  margin: 0 auto 8px;
  border: 2px solid var(--accent, #4a9eff);
}
.chat-camera-preview video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scaleX(-1); /* Mirror for selfie */
}
.chat-camera-toggle.active {
  color: var(--accent, #4a9eff);
}
```

**Step 7: Commit**

```bash
git add ui/src/ui/views/chat.ts ui/src/ui/app.ts ui/src/ui/app-render.ts ui/src/ui/app-chat.ts
git commit -m "feat(webchat): add camera preview widget with toggle in chat compose"
```

---

### Task 3: Auto-Snap on Send

Intercept the chat send flow to capture a webcam frame and inject it as an attachment.

**Files:**
- Modify: `ui/src/ui/app-chat.ts` (lines 159-203, `handleSendChat`)

**Step 1: Modify handleSendChat to auto-capture**

In `ui/src/ui/app-chat.ts`, at the top of `handleSendChat()`, after the `attachments` line (169), add the auto-capture logic:

```typescript
import { captureFrame, isStreamActive } from "./webcam-stream.ts";

// Inside handleSendChat, after line 170:
// Auto-capture webcam frame if camera is active
if (messageOverride == null && isStreamActive()) {
  try {
    const frame = await captureFrame({ maxWidth: 800, quality: 0.85 });
    if (frame) {
      const cameraAttachment: ChatAttachment = {
        id: `cam-${Date.now()}`,
        dataUrl: frame.dataUrl,
        mimeType: frame.mimeType,
      };
      attachmentsToSend = [...attachmentsToSend, cameraAttachment];
    }
  } catch {
    // Camera capture failed silently — send message without image
  }
}
```

Note: `attachmentsToSend` is currently `const` (line 170). Change it to `let`:

```typescript
let attachmentsToSend = messageOverride == null ? attachments : [];
```

And update `hasAttachments` to be recalculated after potential camera capture:

```typescript
const hasAttachments = attachmentsToSend.length > 0;
```

Move the `hasAttachments` line to after the camera capture block.

**Step 2: Commit**

```bash
git add ui/src/ui/app-chat.ts
git commit -m "feat(webchat): auto-capture webcam frame on chat send"
```

---

### Task 4: Add ChatHost properties for camera state

The `ChatHost` type (used by `handleSendChat` and `toggleCamera`) needs the camera properties.

**Files:**
- Modify: `ui/src/ui/app-chat.ts` (the `ChatHost` type definition)

**Step 1: Find and update ChatHost type**

Search for `ChatHost` type in `app-chat.ts` and add:

```typescript
cameraEnabled: boolean;
cameraStream: MediaStream | null;
```

**Step 2: Commit**

```bash
git add ui/src/ui/app-chat.ts
git commit -m "feat(webchat): add camera state to ChatHost type"
```

---

### Task 5: Format, Lint, Typecheck

**Step 1: Run format fix**

Run: `pnpm format:fix`

**Step 2: Run typecheck**

Run: `pnpm tsgo`

Fix any type errors (likely minor adjustments to prop passing or type widening).

**Step 3: Run lint**

Run: `pnpm lint`

Fix any lint issues.

**Step 4: Run existing tests**

Run: `pnpm vitest run`

Ensure no regressions.

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(webchat): fix lint/type issues in live camera feature"
```

---

### Task 6: Build, Deploy, Test

**Step 1: Build**

Run on Mac:
```bash
cd /tmp/openclaw-deploy && git pull origin main
pnpm install && pnpm build && pnpm ui:build
```

**Step 2: Deploy**

```bash
cp -r dist/control-ui "$HOME/.nvm/versions/node/v22.22.0/lib/node_modules/openclaw/dist/control-ui"
launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway
```

**Step 3: Test**

1. Open `http://127.0.0.1:18789/chat?session=main#token=<token>`
2. Click camera toggle button — should see live preview
3. Send a message — ZEKE should see the webcam frame and respond to what it sees
4. Toggle camera off — messages should send without image
