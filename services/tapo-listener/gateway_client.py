"""Gateway WebSocket client for sending messages to ZEKE."""

import asyncio
import json
import logging
import time

import websockets

log = logging.getLogger("tapo-listener.gateway")


class GatewayClient:
    def __init__(self, url: str, token: str, session_key: str = "main"):
        self._url = url
        self._token = token
        self._session_key = session_key
        self._ws = None
        self._connected = False
        self._req_id = 0
        self._pending: dict[str, asyncio.Future] = {}

    def _next_id(self) -> str:
        self._req_id += 1
        return f"tl-{self._req_id}"

    async def connect(self):
        """Connect to gateway and complete handshake."""
        self._ws = await websockets.connect(self._url)

        # Send connect frame
        req_id = self._next_id()
        await self._ws.send(json.dumps({
            "type": "req",
            "id": req_id,
            "method": "connect",
            "params": {
                "minProtocol": 3,
                "maxProtocol": 3,
                "client": {
                    "id": "cli",
                    "displayName": "Tapo Listener",
                    "platform": "macos",
                    "mode": "cli",
                    "version": "1.0.0",
                },
                "auth": {"token": self._token},
                "scopes": ["operator.admin"],
            },
        }))

        # Wait for hello-ok (skip connect.challenge and other events)
        deadline = asyncio.get_event_loop().time() + 10
        while True:
            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                raise ConnectionError("Gateway connect timed out")
            raw = await asyncio.wait_for(self._ws.recv(), timeout=remaining)
            frame = json.loads(raw)
            if frame.get("type") == "event":
                log.debug("Skipping event during handshake: %s", frame.get("event"))
                continue
            if frame.get("type") == "res":
                if frame.get("ok"):
                    self._connected = True
                    log.info("Connected to gateway")
                    break
                else:
                    error = frame.get("error", {}).get("message", "unknown")
                    raise ConnectionError(f"Gateway connect failed: {error}")
            log.debug("Unexpected frame during handshake: %s", frame.get("type"))

        # Start background message reader
        asyncio.create_task(self._read_loop())

    async def _read_loop(self):
        """Read gateway messages in background."""
        try:
            async for raw in self._ws:
                frame = json.loads(raw)
                frame_type = frame.get("type")
                frame_id = frame.get("id")

                # Resolve pending RPC responses
                if frame_type == "res" and frame_id in self._pending:
                    self._pending[frame_id].set_result(frame)
                    del self._pending[frame_id]
        except websockets.ConnectionClosed:
            log.warning("Gateway connection closed")
            self._connected = False

    async def send_chat(self, message: str) -> dict | None:
        """Send a chat message to ZEKE. Returns the response payload."""
        if not self._connected or not self._ws:
            log.warning("Not connected to gateway")
            return None

        req_id = self._next_id()
        future = asyncio.get_event_loop().create_future()
        self._pending[req_id] = future

        await self._ws.send(json.dumps({
            "type": "req",
            "id": req_id,
            "method": "chat.send",
            "params": {
                "sessionKey": self._session_key,
                "message": message,
                "idempotencyKey": f"tl-{int(time.time() * 1000)}",
            },
        }))

        try:
            result = await asyncio.wait_for(future, timeout=30)
            if result.get("ok"):
                log.info("Chat message sent, runId=%s", result.get("payload", {}).get("runId"))
                return result.get("payload")
            else:
                log.warning("Chat send failed: %s", result.get("error", {}).get("message"))
                return None
        except asyncio.TimeoutError:
            log.warning("Chat send timed out")
            self._pending.pop(req_id, None)
            return None

    async def close(self):
        if self._ws:
            await self._ws.close()
            self._connected = False

    @property
    def connected(self) -> bool:
        return self._connected
