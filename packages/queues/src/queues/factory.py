from .local import LocalQueue
from .sqs import SQSQueue
from .azure import AzureQueueClient
from .noop import NoOpQueue
from models.queue_azure_config import QueueAzureConfig
from models.queue_sqs_config import QueueSqsConfig
from models.queue_local_config import QueueLocalConfig
import logging
from typing import Callable, Dict, Optional
from .interface import QueueClient

# Singleton dictionary to store named queue instances
_queues = {}

def create_queue_client(cfg) -> None:
    name = getattr(cfg, "name", None)
    if name is None:
        raise ValueError("Config must provide a name or id")
    if name in _queues:
        logging.error(f"Database client with name '{name}' already exists and will not be replaced.")
        return None
    # Dispatch based on config type using isinstance
    if isinstance(cfg, QueueAzureConfig):
        client = AzureQueueClient(config=cfg)
    elif isinstance(cfg, QueueSqsConfig):
        client = SQSQueue(config=cfg)
    elif isinstance(cfg, QueueLocalConfig):
        client = LocalQueue(config=cfg)
    else:
        raise ValueError(f"Unsupported database config type: {type(cfg)}")
    _queues[name] = client
    return None

def get_queue(name: str = "default") -> Optional[QueueClient]:
    return _queues.get(name)

def get_queue_client(*args, **kwargs):
    """
    Deprecated: use get_queue and create_queue_client with strongly typed config models instead.
    """
    import warnings
    warnings.warn(
        "get_queue_client is deprecated, use get_queue and create_queue_client with strongly typed config models.",
        DeprecationWarning,
        stacklevel=2
    )
    raise DeprecationWarning("get_queue_client is deprecated, use get_queue and create_queue_client with strongly typed config models.")
