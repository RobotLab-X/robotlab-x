import pytest
from unittest.mock import patch, MagicMock
from queues.interface import QueueClient
from queues.message import Message
from queues.local import LocalQueue
from queues.noop import NoOpQueue
from queues.factory import create_queue_client, get_queue
import uuid

def test_queueclient_is_abstract():
    with pytest.raises(TypeError):
        QueueClient()

def test_message_model_defaults():
    msg = Message(name="svc", src="src", method="m", type="async")
    assert isinstance(msg.id, uuid.UUID)
    assert msg.ts is not None
    assert msg.type == "async"
    assert msg.data is None

def test_local_queue_delete_message_and_empty():
    from models.queue_local_config import QueueLocalConfig
    q = LocalQueue(QueueLocalConfig())
    q.send_message("foo")
    assert q.receive_message() == "foo"
    # Deleting a message should not raise
    q.delete_message("bar")
    # Queue is empty
    assert q.receive_message() is None

def test_noop_queue_methods():
    q = NoOpQueue(config={})
    q.send_message("foo")
    assert q.receive_message() is None
    q.delete_message("bar")
    assert q.get_message_count() == 0

def test_factory_invalid_type():
    with pytest.raises(ValueError):
        create_queue_client(object())

def test_sqs_queue_error_handling():
    with patch("queues.sqs.boto3.Session") as mock_session:
        mock_client = MagicMock()
        mock_session.return_value.client.return_value = mock_client
        from queues.sqs import SQSQueue
        from models.queue_sqs_config import QueueSqsConfig
        config = QueueSqsConfig(
            queue_url="https://sqs.us-east-1.amazonaws.com/123/queue",
            aws_access_key_id="key",
            aws_secret_access_key="secret",
            name="test"
        )
        queue = SQSQueue(config)
        # Simulate AWS client raising an error
        mock_client.send_message.side_effect = Exception("fail")
        with pytest.raises(Exception):
            queue.send_message("msg")
        mock_client.receive_message.side_effect = Exception("fail")
        with pytest.raises(Exception):
            queue.receive_message()
        mock_client.delete_message.side_effect = Exception("fail")
        with pytest.raises(Exception):
            queue.delete_message("id")
        mock_client.get_queue_attributes.side_effect = Exception("fail")
        with pytest.raises(Exception):
            queue.get_message_count()

def test_factory_create_and_get():
    from models.queue_local_config import QueueLocalConfig
    cfg = QueueLocalConfig(name="test_create_and_get")
    create_queue_client(cfg)
    q = get_queue("test_create_and_get")
    assert isinstance(q, LocalQueue)

def test_factory_singleton_behavior():
    from models.queue_local_config import QueueLocalConfig
    from queues.factory import create_queue_client, get_queue
    from queues.local import LocalQueue
    cfg = QueueLocalConfig(name="singleton")
    create_queue_client(cfg)
    q1 = get_queue("singleton")
    create_queue_client(cfg)  # Should not replace existing
    q2 = get_queue("singleton")
    assert q1 is q2
    assert isinstance(q1, LocalQueue)
    create_queue_client(cfg)
    q1 = get_queue("singleton")
    create_queue_client(cfg)  # Should not replace existing
    q2 = get_queue("singleton")
    assert q1 is q2
    assert isinstance(q1, LocalQueue)
