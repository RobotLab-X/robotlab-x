from abc import ABC, abstractmethod

class QueueClient(ABC):
    """Abstract class for queue implementations."""

    @abstractmethod
    def send_message(self, message: str):
        pass

    @abstractmethod
    def receive_message(self):
        pass

    @abstractmethod
    def delete_message(self, message_id):
        pass

    @abstractmethod
    def get_message_count(self):
        pass
