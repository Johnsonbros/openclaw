/**
 * Browser camera service — implements camera.list, camera.snap, camera.clip
 * using Web MediaDevices / MediaRecorder APIs.
 */

const MAX_BASE64_BYTES = 8 * 1024 * 1024; // ~8 MB

type CameraDevice = {
  id: string;
  name: string;
  position: "front" | "unknown";
  deviceType: "webcam";
};

type CameraListResult = { devices: CameraDevice[] };

type CameraSnapParams = {
  maxWidth?: number;
  quality?: number;
  deviceId?: string;
  delayMs?: number;
};

type CameraSnapResult = {
  format: "jpg";
  base64: string;
  width: number;
  height: number;
};

type CameraClipParams = {
  durationMs?: number;
  includeAudio?: boolean;
  deviceId?: string;
};

type CameraClipResult = {
  format: "webm";
  base64: string;
  durationMs: number;
  hasAudio: boolean;
};

type CameraOk<T> = { ok: true; result: T };
type CameraErr = { ok: false; error: { code: string; message: string } };
type CameraResult<T> = CameraOk<T> | CameraErr;

function err(code: string, message: string): CameraErr {
  return { ok: false, error: { code, message } };
}

function wrapMediaError(e: unknown): CameraErr {
  if (e instanceof DOMException) {
    if (e.name === "NotAllowedError") {
      return err("PERMISSION_DENIED", "Camera/microphone permission denied by user");
    }
    if (e.name === "NotFoundError") {
      return err("UNAVAILABLE", "No camera or microphone found");
    }
    if (e.name === "NotReadableError") {
      return err("UNAVAILABLE", "Camera is in use by another application");
    }
  }
  return err("CAPTURE_FAILED", String(e));
}

function clampDuration(ms: number | undefined): number {
  const raw = typeof ms === "number" ? ms : 3000;
  return Math.max(250, Math.min(60_000, raw));
}

/** Serialize concurrent camera requests so we don't open two streams at once. */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.then(
    () => {},
    () => {},
  );
  return next;
}

export async function cameraList(): Promise<CameraResult<CameraListResult>> {
  return enqueue(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return err("UNAVAILABLE", "MediaDevices API not available (HTTPS required)");
    }
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const videos = all.filter((d) => d.kind === "videoinput");
      const devices: CameraDevice[] = videos.map((d) => ({
        id: d.deviceId,
        name: d.label || `Camera ${d.deviceId.slice(0, 8)}`,
        position: "front" as const,
        deviceType: "webcam" as const,
      }));
      return { ok: true, result: { devices } };
    } catch (e) {
      return wrapMediaError(e);
    }
  });
}

export async function cameraSnap(
  params?: CameraSnapParams,
): Promise<CameraResult<CameraSnapResult>> {
  return enqueue(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      return err("UNAVAILABLE", "getUserMedia not available (HTTPS required)");
    }
    let stream: MediaStream | null = null;
    try {
      const maxWidth = params?.maxWidth ?? 1600;
      const quality = params?.quality ?? 0.9;

      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: maxWidth },
          ...(params?.deviceId ? { deviceId: { exact: params.deviceId } } : {}),
        },
        audio: false,
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);

      if (params?.delayMs && params.delayMs > 0) {
        await new Promise((r) => setTimeout(r, Math.min(params.delayMs!, 10_000)));
      }

      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings();
      const vw = settings.width ?? 640;
      const vh = settings.height ?? 480;

      // Scale down if needed
      let canvasW = vw;
      let canvasH = vh;
      if (canvasW > maxWidth) {
        const ratio = maxWidth / canvasW;
        canvasW = maxWidth;
        canvasH = Math.round(canvasH * ratio);
      }

      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();

      // Wait one frame for the video to render
      await new Promise((r) => requestAnimationFrame(r));

      const canvas = document.createElement("canvas");
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(video, 0, 0, canvasW, canvasH);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      if (!blob) {
        return err("CAPTURE_FAILED", "Failed to encode JPEG frame");
      }

      const base64 = await blobToBase64(blob);
      if (base64.length > MAX_BASE64_BYTES) {
        return err(
          "SIZE_EXCEEDED",
          "Captured image exceeds 8 MB; try reducing maxWidth or quality",
        );
      }

      return { ok: true, result: { format: "jpg", base64, width: canvasW, height: canvasH } };
    } catch (e) {
      return wrapMediaError(e);
    } finally {
      stopTracks(stream);
    }
  });
}

export async function cameraClip(
  params?: CameraClipParams,
): Promise<CameraResult<CameraClipResult>> {
  return enqueue(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      return err("UNAVAILABLE", "getUserMedia not available (HTTPS required)");
    }
    let stream: MediaStream | null = null;
    try {
      const durationMs = clampDuration(params?.durationMs);
      const includeAudio = params?.includeAudio !== false;

      const constraints: MediaStreamConstraints = {
        video: params?.deviceId ? { deviceId: { exact: params.deviceId } } : {},
        audio: includeAudio,
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);

      const hasAudio = stream.getAudioTracks().length > 0;
      const mimeType = pickRecorderMime();
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];

      const recordingDone = new Promise<Blob>((resolve, reject) => {
        recorder.addEventListener("dataavailable", (e) => {
          if (e.data.size > 0) {
            chunks.push(e.data);
          }
        });
        recorder.addEventListener("stop", () => resolve(new Blob(chunks, { type: mimeType })));
        recorder.addEventListener("error", () => reject(new Error("MediaRecorder error")));
      });

      recorder.start();
      await new Promise((r) => setTimeout(r, durationMs));
      recorder.stop();

      const blob = await recordingDone;
      const base64 = await blobToBase64(blob);
      if (base64.length > MAX_BASE64_BYTES) {
        return err(
          "SIZE_EXCEEDED",
          `Clip is too large (${Math.round(base64.length / 1024)}KB); try a shorter duration`,
        );
      }

      return { ok: true, result: { format: "webm", base64, durationMs, hasAudio } };
    } catch (e) {
      return wrapMediaError(e);
    } finally {
      stopTracks(stream);
    }
  });
}

function pickRecorderMime(): string {
  const preferred = ["video/webm;codecs=vp8,opus", "video/webm"];
  for (const m of preferred) {
    if (MediaRecorder.isTypeSupported(m)) {
      return m;
    }
  }
  return "video/webm";
}

function stopTracks(stream: MediaStream | null) {
  if (!stream) {
    return;
  }
  for (const t of stream.getTracks()) {
    t.stop();
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const dataUrl = reader.result as string;
      // Strip the data URL prefix (e.g., "data:image/jpeg;base64,")
      const idx = dataUrl.indexOf(",");
      resolve(idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl);
    });
    reader.addEventListener("error", () => reject(new Error("FileReader error")));
    reader.readAsDataURL(blob);
  });
}

/** Dispatch a camera command from the node invoke protocol. */
export async function handleCameraCommand(
  command: string,
  paramsJSON: string | null,
): Promise<
  { ok: true; payloadJSON: string } | { ok: false; error: { code: string; message: string } }
> {
  const params = paramsJSON ? JSON.parse(paramsJSON) : undefined;

  let result: CameraResult<unknown>;
  switch (command) {
    case "camera.list":
      result = await cameraList();
      break;
    case "camera.snap":
      result = await cameraSnap(params);
      break;
    case "camera.clip":
      result = await cameraClip(params);
      break;
    default:
      return {
        ok: false,
        error: { code: "UNKNOWN_COMMAND", message: `Unknown command: ${command}` },
      };
  }

  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true, payloadJSON: JSON.stringify(result.result) };
}
