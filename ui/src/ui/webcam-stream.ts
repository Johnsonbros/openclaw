let currentStream: MediaStream | null = null;

export async function openStream(): Promise<MediaStream> {
  if (currentStream) { return currentStream; }
  currentStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  return currentStream;
}

export function closeStream(): void {
  if (!currentStream) { return; }
  for (const track of currentStream.getTracks()) { track.stop(); }
  currentStream = null;
}

export function getStream(): MediaStream | null { return currentStream; }
export function isStreamActive(): boolean { return currentStream !== null; }

export async function captureFrame(opts?: { maxWidth?: number; quality?: number }): Promise<{ dataUrl: string; mimeType: string } | null> {
  if (!currentStream) { return null; }
  const maxWidth = opts?.maxWidth ?? 800;
  const quality = opts?.quality ?? 0.85;
  const track = currentStream.getVideoTracks()[0];
  const settings = track.getSettings();
  let w = settings.width ?? 640;
  let h = settings.height ?? 480;
  if (w > maxWidth) { const ratio = maxWidth / w; h = Math.round(h * ratio); w = maxWidth; }

  const video = document.createElement("video");
  video.srcObject = currentStream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  await new Promise((r) => requestAnimationFrame(r));

  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(video, 0, 0, w, h);
  video.pause();
  video.srcObject = null;

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) { return null; }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result as string));
    reader.addEventListener("error", () => reject(new Error("FileReader error")));
    reader.readAsDataURL(blob);
  });
  return { dataUrl, mimeType: "image/jpeg" };
}
