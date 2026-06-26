from queues.local import LocalQueue
from models.queue_local_config import QueueLocalConfig

def test_local_queue():
    config = QueueLocalConfig()
    queue = LocalQueue(config=config)
    queue.send_message("test")
    assert queue.receive_message() == "test"
