@echo off
echo [whisper-server] Starting Whisper transcription server on port 8778...
echo [whisper-server] Requires: faster-whisper, ctranslate2, fastapi, uvicorn, soundfile, numpy
echo [whisper-server] GPU: NVIDIA P2200 (CUDA)
echo.

cd /d "%~dp0"
python server.py

pause
