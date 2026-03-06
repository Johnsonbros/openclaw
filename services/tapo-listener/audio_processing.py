"""Audio energy detection and Whisper transcription client."""

import logging

import httpx
import numpy as np

log = logging.getLogger("tapo-listener.audio")


def compute_rms(pcm: bytes) -> float:
    """Compute RMS energy of 16-bit signed PCM."""
    sample_count = len(pcm) // 2
    if sample_count == 0:
        return 0.0
    samples = np.frombuffer(pcm, dtype=np.int16)
    return float(np.sqrt(np.mean(samples.astype(np.float64) ** 2)))


def has_energy(pcm: bytes, threshold: float = 200.0) -> bool:
    """Return True if audio has energy above silence threshold."""
    return compute_rms(pcm) > threshold


async def transcribe(pcm: bytes, whisper_url: str = "http://localhost:8778") -> str | None:
    """Send raw PCM to Whisper server, return transcript or None."""
    if len(pcm) < 32:
        return None
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{whisper_url}/transcribe",
                content=pcm,
                headers={"Content-Type": "application/octet-stream"},
            )
            if resp.status_code != 200:
                log.warning("Whisper HTTP %d", resp.status_code)
                return None
            data = resp.json()
            text = data.get("text", "").strip()
            return text if text else None
    except Exception as e:
        log.warning("Whisper request failed: %s", e)
        return None
