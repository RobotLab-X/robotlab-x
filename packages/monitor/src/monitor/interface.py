from abc import ABC, abstractmethod
from typing import Any
from models.monitor_local_config import MonitorLocalConfig
from models.monitor_data import MonitorData

class IMonitor(ABC):

    @abstractmethod
    def start(self) -> None:
        """Start the monitor."""
        pass

    @abstractmethod
    def stop(self) -> None:
        """Stop the monitor."""
        pass

    @abstractmethod
    def get_data(self) -> MonitorData:
        """Return the latest monitor data."""
        pass
