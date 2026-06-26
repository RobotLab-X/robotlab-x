import logging
from typing import Optional
from .interface import MessageClient
from .levels import MessageLevel

logger = logging.getLogger(__name__)


from models.messages_local_config import MessagesLocalConfig

emoji_map = {
                "DEBUG": "⚙️",
                "INFO": "ℹ️",
                "WARNING": "⚠️",
                "ERROR": "🚨",
                "CRITICAL": "💥",
                "SUCCESS": "✅",
            }

class LocalMessageClient(MessageClient):
    def __init__(self, cfg: MessagesLocalConfig):
        self.cfg = cfg
        self.msg_count = 0
        self.last_message = ""
        self.sent_messages = []  # Backwards compatibility for tests expecting this
        if getattr(cfg, "logger_name", None):
            self.logger = logging.getLogger(cfg.logger_name)
        else:
            self.logger = logger

    def send_message(self, content: str, level: Optional[MessageLevel] = None, recipient: Optional[str] = None) -> None:
        """Send a local message. If use_print is True the message is printed to stdout.

        Otherwise the configured logger is used. The optional `level` follows
        MessageLevel enum values. If not provided, INFO is used.
        """
        level_name = level.name if level is not None else "INFO"
        emoji = emoji_map.get(level_name, "")
        msg = f"[LocalMessage:{self.cfg.name}] -> {recipient or ''}: {emoji} {content}"
        self.msg_count += 1
        self.last_message = msg
        if self.cfg.buffer_messages:
            self.sent_messages.append(msg)
        if self.cfg.use_print:
            print(f"[{level_name}] {self.cfg.prefix} {msg}")
            return

        # map to logging level names; default to INFO
        mapping = {
            "DEBUG": logging.DEBUG,
            "INFO": logging.INFO,
            "WARNING": logging.WARNING,
            "ERROR": logging.ERROR,
            "CRITICAL": logging.CRITICAL,
            "SUCCESS": logging.INFO,
        }
        log_level = mapping.get(level_name, logging.INFO)

        try:
            self.logger.log(log_level, f"{self.cfg.prefix} {msg}")
        except Exception:
            # fallback to info
            self.logger.info(msg)

__all__ = ["MessagesLocalConfig", "LocalMessageClient"]
