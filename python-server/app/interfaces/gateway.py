from abc import ABC, abstractmethod

class Gateway(ABC):
    @property
    @abstractmethod
    def fullname(self) -> str:
        pass

    @abstractmethod
    def send_remote(self, msg):
        pass
