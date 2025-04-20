from abc import ABC, abstractmethod

class Registry(ABC):
    @abstractmethod
    def register(self, key: str, value):
        pass

    @abstractmethod
    def release(self, key: str):
        pass

    @abstractmethod
    def get_service(self, key: str):
        pass

    @abstractmethod
    def get_registry(self):
        pass

    @abstractmethod
    def get_service_names(self):
        pass
