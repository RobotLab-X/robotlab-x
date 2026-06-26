import logging
from models.queue_noop_config import QueueNoopConfig
from .interface import QueueClient

logger = logging.getLogger(__name__)

class NoOpQueue(QueueClient):
    def __init__(self, config: QueueNoopConfig):
        self.config = config
        logger.info("NoOpQueue initialized")
        print("[NoOpQueue] Initialized")

    def send_message(self, message: str):
        logger.info(f"NoOpQueue.send_message called with: {message!r}")
        print(f"[NoOpQueue] send_message called with: {message!r}")

    def receive_message(self):
        logger.info("NoOpQueue.receive_message called")
        print("[NoOpQueue] receive_message called")
        return None

    def delete_message(self, message_id):
        logger.info(f"NoOpQueue.delete_message called with: {message_id!r}")
        print(f"[NoOpQueue] delete_message called with: {message_id!r}")

    def get_message_count(self):
        logger.info("NoOpQueue.get_message_count called")
        print("[NoOpQueue] get_message_count called")
        return 0
