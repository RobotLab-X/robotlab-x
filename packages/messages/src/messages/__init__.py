"""messages package - lightweight messaging client manager

Public API:
- create_message_client(cfg: MessageConfig) -> MessageClient
- get_message_client(name: str) -> Optional[MessageClient]
- MessageLevel and convenience level constants (DEBUG, INFO, ...)
"""
from .factory import create_message_client, get_message_client
from .levels import MessageLevel, DEBUG, INFO, WARNING, ERROR, CRITICAL, SUCCESS

# configs live as compatibility wrappers on the top-level client modules
from .slack import MessagesSlackConfig
from .google_chat import MessagesGoogleChatConfig
from .local import MessagesLocalConfig

# client implementations live at the top-level modules
from .slack import SlackClient
from .google_chat import GoogleChatClient
from .local import LocalMessageClient

__version__ = "0.1.0"

__all__ = [
    "create_message_client",
    "get_message_client",
    "MessageLevel",
    "DEBUG",
    "INFO",
    "WARNING",
    "ERROR",
    "CRITICAL",
    "SUCCESS",
    "SlackClient",
    "MessagesSlackConfig",
    "GoogleChatClient",
    "MessagesGoogleChatConfig",
    "LocalMessageClient",
    "MessagesLocalConfig",
]

