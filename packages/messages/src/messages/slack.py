import logging
from typing import Optional
import requests
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError
from .interface import MessageClient
from .levels import MessageLevel

logger = logging.getLogger(__name__)


from models.messages_slack_config import MessagesSlackConfig


class SlackClient(MessageClient):
    def __init__(self, cfg: MessagesSlackConfig):
        self.cfg = cfg
        self.web_client = WebClient(token=cfg.slack_token)

    def send_message(self, content: str, level: Optional[MessageLevel] = None, recipient: Optional[str] = None) -> None:
        """Send a message to Slack via WebClient.

        The optional `level` is included as a simple emoji prefix in the posted text for visibility.
        If `recipient` is provided it is appended to the message text for informational purposes.
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
        prefix = f"[{level_name}] {emoji} {self.cfg.prefix} "
        text = prefix + content
        if recipient:
            text = f"{text} (to {recipient})"
        if not self.cfg.channel:
            raise ValueError("Slack channel must be specified in config for WebClient usage.")
        try:
            self.web_client.chat_postMessage(channel=self.cfg.channel, text=text)
        except SlackApiError as e:
            logger.exception("Failed to send Slack message via WebClient: %s", e.response["error"])
            raise


__all__ = ["MessagesSlackConfig", "SlackClient"]
