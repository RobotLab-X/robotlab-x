import queue
from .interface import QueueClient
from models.queue_local_config import QueueLocalConfig
class LocalQueue(QueueClient):
    def __init__(self, config: QueueLocalConfig): # FIXME default to = QueueLocalConfig() ?
        self.config = config
        self.q = queue.Queue()

    def send_message(self, message: str):
        self.q.put(message)

    def receive_message(self):
        return self.q.get() if not self.q.empty() else None

    def delete_message(self, message_id):
        pass  # Not needed for local testing

    def get_message_count(self):
        return self.q.qsize()