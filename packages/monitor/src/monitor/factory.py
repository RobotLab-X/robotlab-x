from .local_monitor import LocalMonitor
from models.monitor_local_config import MonitorLocalConfig
from .interface import IMonitor
import logging
from typing import Optional

_monitors = {}

def create_monitor(config) -> None:
    name = getattr(config, "name", None)
    if name is None:
        raise ValueError("Config must provide a name or id")
    if name in _monitors:
        logging.error(f"Monitor with name '{name}' already exists and will not be replaced.")
        return None
    # Dispatch based on config type using isinstance
    if isinstance(config, MonitorLocalConfig):
        monitor = LocalMonitor(config)
    else:
        raise ValueError(f"Unsupported monitor config type: {type(config)}")
    _monitors[name] = monitor
    return None

def get_monitor(name: str = "default") -> Optional[IMonitor]:
    return _monitors.get(name)
