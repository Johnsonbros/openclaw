"""Wake word detection and conversation mode state machine."""

import logging
import re
import time

log = logging.getLogger("tapo-listener.wake")


class WakeDetector:
    # States
    IDLE = "idle"
    BUFFERING = "buffering"      # wake detected, buffering full utterance
    CONVERSATION = "conversation"  # active conversation, no wake word needed

    def __init__(
        self,
        wake_words: list[str] | None = None,
        conversation_timeout: float = 30.0,
        silence_gap: float = 2.0,
        exit_phrases: list[str] | None = None,
    ):
        self._wake_patterns = [
            re.compile(rf"\b{re.escape(w)}\b", re.IGNORECASE)
            for w in (wake_words or ["zeke"])
        ]
        self._exit_patterns = [
            re.compile(rf"\b{re.escape(p)}\b", re.IGNORECASE)
            for p in (exit_phrases or ["bye", "stop", "thanks", "thank you", "goodbye"])
        ]
        self._conversation_timeout = conversation_timeout
        self._silence_gap = silence_gap

        self._state = self.IDLE
        self._last_speech_time = 0.0
        self._conversation_start = 0.0
        self._buffered_texts: list[str] = []

    @property
    def state(self) -> str:
        return self._state

    @property
    def in_conversation(self) -> bool:
        return self._state == self.CONVERSATION

    def process_transcript(self, text: str) -> dict | None:
        """Process a transcript. Returns action dict or None.

        Possible return values:
        - {"action": "wake", "text": "full utterance"} -- wake word detected, send to ZEKE
        - {"action": "message", "text": "follow-up"} -- conversation follow-up, send to ZEKE
        - {"action": "end_conversation"} -- conversation ended
        - None -- no action (background chatter in IDLE, or silence)
        """
        now = time.monotonic()

        if not text or not text.strip():
            return self._check_timeout(now)

        self._last_speech_time = now

        if self._state == self.IDLE:
            # Check for wake word
            if self._has_wake_word(text):
                self._state = self.CONVERSATION
                self._conversation_start = now
                log.info("Wake word detected: %s", text[:80])
                return {"action": "wake", "text": text}
            return None  # background chatter, ignore

        if self._state == self.CONVERSATION:
            # Check for exit phrases
            if self._has_exit_phrase(text):
                self._state = self.IDLE
                log.info("Conversation ended by exit phrase")
                return {"action": "end_conversation"}

            # Check conversation timeout
            if now - self._conversation_start > self._conversation_timeout:
                self._state = self.IDLE
                log.info("Conversation timed out")
                return {"action": "end_conversation"}

            # It's a follow-up message
            return {"action": "message", "text": text}

        return None

    def _check_timeout(self, now: float) -> dict | None:
        """Check if conversation should end due to silence timeout."""
        if self._state == self.CONVERSATION:
            if self._last_speech_time > 0 and (now - self._last_speech_time) > self._conversation_timeout:
                self._state = self.IDLE
                log.info("Conversation ended by silence timeout")
                return {"action": "end_conversation"}
        return None

    def force_end(self):
        """Force end conversation mode."""
        self._state = self.IDLE

    def _has_wake_word(self, text: str) -> bool:
        return any(p.search(text) for p in self._wake_patterns)

    def _has_exit_phrase(self, text: str) -> bool:
        return any(p.search(text) for p in self._exit_patterns)
