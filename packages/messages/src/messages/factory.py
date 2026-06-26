from typing import Dict, Optional
# shared external pydantic config models (aliased to local names)
from models.messages_local_config import MessagesLocalConfig as MessagesLocalConfig
from models.messages_google_chat_config import MessagesGoogleChatConfig as MessagesGoogleChatConfig
from models.messages_slack_config import MessagesSlackConfig as MessagesSlackConfig

# client implementations live at the top-level modules
from .local import LocalMessageClient
from .google_chat import GoogleChatClient
from .slack import SlackClient
from .interface import MessageConfig, MessageClient

_clients: Dict[str, MessageClient] = {}


def create_message_client(cfg: MessageConfig) -> None:
    """Register a singleton message client for the given config.

    This function should be called once at application startup to initialize clients
    from configuration (possibly with secrets). It registers the constructed client
    under cfg.name for later retrieval by `get_message_client(name)`.

    Note: this function intentionally returns None to emphasize that client
    retrieval should be performed via `get_message_client()` in application code.
    """
    name = getattr(cfg, "name", None)
    if name is None:
        raise ValueError("Config must provide a name or id")

    if name in _clients:
        # already registered; nothing to do
        return None

    # dispatch based on config type
    if isinstance(cfg, MessagesLocalConfig):
        client = LocalMessageClient(cfg)
    elif isinstance(cfg, MessagesGoogleChatConfig):
        client = GoogleChatClient(cfg)
    elif isinstance(cfg, MessagesSlackConfig):
        client = SlackClient(cfg)
    else:
        raise ValueError(f"Unsupported message config type: {type(cfg)}")

    _clients[name] = client
    return None


def get_message_client(name: str = "default") -> Optional[MessageClient]:
    """Return the previously-registered client by name, or None if not registered."""
    return _clients.get(name)
