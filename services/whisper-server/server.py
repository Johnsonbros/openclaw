"""
Whisper transcription server for Zeke ambient hearing.

Accepts raw PCM audio (16-bit, 16kHz, mono) via POST /transcribe,
transcribes using faster-whisper on GPU, returns text.
"""

import io
import struct
import time
from contextlib import asynccontextmanager

import numpy as np
import soundfile as sf
from fastapi import FastAPI, Request, Response
from faster_whisper import WhisperModel

model: WhisperModel | None = None


def pcm_to_wav_bytes(pcm: bytes, sample_rate: int = 16000, channels: int = 1, sample_width: int = 2) -> bytes:
    """Wrap raw PCM in a WAV header so soundfile can read it."""
    buf = io.BytesIO()
    data_size = len(pcm)
    # RIFF header
    buf.write(b"RIFF")
    buf.write(struct.pack("<I", 36 + data_size))
    buf.write(b"WAVE")
    # fmt chunk
    buf.write(b"fmt ")
    buf.write(struct.pack("<I", 16))  # chunk size
    buf.write(struct.pack("<H", 1))   # PCM format
    buf.write(struct.pack("<H", channels))
    buf.write(struct.pack("<I", sample_rate))
    buf.write(struct.pack("<I", sample_rate * channels * sample_width))  # byte rate
    buf.write(struct.pack("<H", channels * sample_width))  # block align
    buf.write(struct.pack("<H", sample_width * 8))  # bits per sample
    # data chunk
    buf.write(b"data")
    buf.write(struct.pack("<I", data_size))
    buf.write(pcm)
    return buf.getvalue()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    print("[whisper] Loading model 'small' on CUDA with float16...")
    t0 = time.time()
    model = WhisperModel("small", device="cuda", compute_type="float16")
    print(f"[whisper] Model loaded in {time.time() - t0:.1f}s")
    yield
    model = None


app = FastAPI(lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok", "model": "small", "device": "cuda"}


@app.post("/transcribe")
async def transcribe(request: Request):
    pcm_data = await request.body()
    if len(pcm_data) < 32:
        return {"text": "", "language": "", "duration": 0.0}

    wav_bytes = pcm_to_wav_bytes(pcm_data)
    audio_array, sr = sf.read(io.BytesIO(wav_bytes), dtype="float32")

    duration = len(audio_array) / sr

    segments, info = model.transcribe(
        np.asarray(audio_array),
        beam_size=5,
        language="en",
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500),
    )

    texts = []
    for segment in segments:
        texts.append(segment.text.strip())

    text = " ".join(texts).strip()

    return {
        "text": text,
        "language": info.language,
        "duration": round(duration, 2),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8778)
