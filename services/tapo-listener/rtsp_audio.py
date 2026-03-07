"""RTSP audio capture via ffmpeg subprocess."""

import asyncio
import logging
import os
import shutil
from urllib.parse import quote

log = logging.getLogger("tapo-listener.rtsp")

CHUNK_DURATION_S = 1
SAMPLE_RATE = 16000
SAMPLE_WIDTH = 2  # 16-bit
CHANNELS = 1
CHUNK_BYTES = SAMPLE_RATE * SAMPLE_WIDTH * CHANNELS * CHUNK_DURATION_S  # 32000


class RtspAudioCapture:
    def __init__(self, host: str, user: str, password: str, port: int = 554, stream: str = "stream1"):
        safe_user = quote(user, safe="")
        safe_pass = quote(password, safe="")
        self._rtsp_url = f"rtsp://{safe_user}:{safe_pass}@{host}:{port}/{stream}"
        self._process: asyncio.subprocess.Process | None = None
        self._running = False

    async def start(self):
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            raise RuntimeError("ffmpeg not found on PATH")

        self._running = True
        self._process = await asyncio.create_subprocess_exec(
            ffmpeg,
            "-hide_banner", "-loglevel", "warning",
            "-rtsp_transport", "tcp",
            "-i", self._rtsp_url,
            "-acodec", "pcm_s16le",         # 16-bit PCM (no -vn or -map 0:a — camera rejects stream filtering)
            "-ar", str(SAMPLE_RATE),        # 16kHz
            "-ac", str(CHANNELS),           # mono
            "-f", "s16le",                  # raw PCM output
            "pipe:1",
            stdout=asyncio.subprocess.PIPE,
            stderr=open(os.devnull, "w"),
        )
        log.info("RTSP audio capture started: %s", self._rtsp_url.split("@")[-1])

    async def read_chunk(self) -> bytes | None:
        """Read one second of PCM audio. Returns None if stream ended."""
        if not self._process or not self._process.stdout:
            return None
        try:
            data = await self._process.stdout.readexactly(CHUNK_BYTES)
            return data
        except (asyncio.IncompleteReadError, ConnectionError):
            log.warning("RTSP stream ended or interrupted")
            return None

    async def stop(self):
        self._running = False
        if self._process:
            self._process.terminate()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=5)
            except asyncio.TimeoutError:
                self._process.kill()
            self._process = None
            log.info("RTSP audio capture stopped")

    @property
    def running(self) -> bool:
        return self._running and self._process is not None and self._process.returncode is None
