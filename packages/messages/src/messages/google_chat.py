import logging
from typing import Optional
import requests
from .interface import MessageClient
from .levels import MessageLevel

logger = logging.getLogger(__name__)

# Import the shared external config and provide a thin compatibility wrapper so
# callers can construct with `name=` (tests/docs) while the shared model uses `id`.

from models.messages_google_chat_config import MessagesGoogleChatConfig


class GoogleChatClient(MessageClient):
    def __init__(self, cfg: MessagesGoogleChatConfig):
        self.cfg = cfg

    def send_message(self, content: str, level: Optional[MessageLevel] = None, recipient: Optional[str] = None) -> None:
        """Send a message to Google Chat via incoming webhook. The recipient is ignored.

        The optional `level` is included as a simple emoji prefix in the posted text for visibility.
        """
        emoji_map = {
            "DEBUG": "⚙️",
            "INFO": "ℹ️",
            "WARNING": "⚠️",
            "ERROR": "🚨",
            "CRITICAL": "💥",
            "SUCCESS": "✅",
        }
        level_name = level.name if level is not None else "INFO"
        emoji = emoji_map.get(level_name, "")
        prefix = f"[{level_name}] {emoji} "
        payload = {"text": prefix + self.cfg.prefix + " " + content}
        try:
            resp = requests.post(self.cfg.webhook_url, json=payload, timeout=5)
            resp.raise_for_status()
        except Exception as e:
            logger.exception("Failed to send Google Chat message: %s", e)
            raise


__all__ = ["MessagesGoogleChatConfig", "GoogleChatClient"]

