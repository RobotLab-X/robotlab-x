# Demonstration: NoOpQueue usage and logging
def test_noop_queue_logging_and_behavior(capfd):
    from queues.noop import NoOpQueue

    queue = NoOpQueue(config={})
    queue.send_message("test-message")
    result = queue.receive_message()
    queue.delete_message("fake-id")
    count = queue.get_message_count()

    # NoOpQueue always returns None for receive and 0 for count
    assert result is None
    assert count == 0

    # Capture printed output for developer visibility
    out, err = capfd.readouterr()
    assert "NoOpQueue" in out
"""
This test file demonstrates the recommended developer flow for creating, registering, and using multiple queues in the cloudseeder queues package.
It shows how to:
- Create and register queues with different names
- Retrieve queues by name using get_queue
- Send and receive messages on each queue independently
- Confirm singleton behavior (same instance returned for same name)
"""
import pytest
from models.queue_local_config import QueueLocalConfig
from queues.factory import create_queue_client, get_queue
from queues.local import LocalQueue

def test_multiple_queue_creation_and_usage():
    # Create and register two queues
    config1 = QueueLocalConfig(name="queue1")
    config2 = QueueLocalConfig(name="queue2")
    create_queue_client(config1)
    create_queue_client(config2)

    # Retrieve queues by name
    q1 = get_queue("queue1")
    q2 = get_queue("queue2")
    assert isinstance(q1, LocalQueue)
    assert isinstance(q2, LocalQueue)
    assert q1 is not q2

    # Send and receive messages independently
    q1.send_message("msg1")
    q2.send_message("msg2")
    assert q1.get_message_count() == 1
    assert q2.get_message_count() == 1
    assert q1.receive_message() == "msg1"
    assert q2.receive_message() == "msg2"
    assert q1.receive_message() is None
    assert q2.receive_message() is None

    # Confirm singleton behavior
    q1_again = get_queue("queue1")
    q2_again = get_queue("queue2")
    assert q1_again is q1
    assert q2_again is q2

    # You can create and use more queues as needed
    config3 = QueueLocalConfig(name="queue3")
    create_queue_client(config3)
    q3 = get_queue("queue3")
    q3.send_message("third")
    assert q3.receive_message() == "third"
    assert q3.receive_message() is None
