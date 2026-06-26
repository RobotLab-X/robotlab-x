from abc import ABC, abstractmethod
from typing import Optional
from pydantic import BaseModel

from .levels import MessageLevel, DEBUG, INFO, WARNING, ERROR, CRITICAL, SUCCESS


# FIXME - this is garbage - generated pydantic models do not have inheritence
class MessageConfig(BaseModel):
    """Base pydantic config for message clients."""
    name: str


class MessageClient(ABC):
    """Abstract interface for message clients (sync, simple)."""

    @abstractmethod
    def send_message(self, content: str, level: Optional[MessageLevel] = None, recipient: Optional[str] = None) -> None:
        """Send a message.

        The most common usage is to send a textual message (content). The second
        most common usage supplies a `level` (a `MessageLevel` enum member) which
        implementations may use to highlight severity. An optional `recipient` can
        be supplied as the third argument when routing is needed.
        """
        
    # Convenience helper methods for common levels. These delegate to
    # send_message so concrete clients automatically get them.
    def send_debug_message(self, content: str, recipient: Optional[str] = None) -> None:
        """Send a message at DEBUG level."""
        self.send_message(content, level=DEBUG, recipient=recipient)

    def send_info_message(self, content: str, recipient: Optional[str] = None) -> None:
        """Send a message at INFO level."""
        self.send_message(content, level=INFO, recipient=recipient)

    def send_warning_message(self, content: str, recipient: Optional[str] = None) -> None:
        """Send a message at WARNING level."""
        self.send_message(content, level=WARNING, recipient=recipient)

    def send_error_message(self, content: str, recipient: Optional[str] = None) -> None:
        """Send a message at ERROR level."""
        self.send_message(content, level=ERROR, recipient=recipient)

    def send_critical_message(self, content: str, recipient: Optional[str] = None) -> None:
        """Send a message at CRITICAL level."""
        self.send_message(content, level=CRITICAL, recipient=recipient)

    def send_success_message(self, content: str, recipient: Optional[str] = None) -> None:
        """Send a message at SUCCESS level."""
        self.send_message(content, level=SUCCESS, recipient=recipient)

