import pytest
from unittest.mock import patch, MagicMock
from queues import __version__
from queues.local import LocalQueue
from queues.noop import NoOpQueue
from models.queue_local_config import QueueLocalConfig

# Test version
def test_version():
    assert __version__ == "0.1.0"

# Test LocalQueue basic send/receive
def test_local_queue_send_receive():
    queue = LocalQueue(QueueLocalConfig())
    queue.send_message("test")
    assert queue.receive_message() == "test"
    assert queue.receive_message() is None

# Test LocalQueue message count
def test_local_queue_count():
    queue = LocalQueue(QueueLocalConfig())
    assert queue.get_message_count() == 0
    queue.send_message("a")
    queue.send_message("b")
    assert queue.get_message_count() == 2
    queue.receive_message()
    assert queue.get_message_count() == 1

# Test NoOpQueue
def test_noop_queue():
    # Provide a dummy config for NoOpQueue
    queue = NoOpQueue(config={})
    queue.send_message("msg")  # Should do nothing
    assert queue.receive_message() is None
    assert queue.get_message_count() == 0
    queue.delete_message("id")  # Should do nothing

# Test SQSQueue (mocked)
def test_sqs_queue_send_receive():
    with patch("queues.sqs.boto3.Session") as mock_session:
        mock_client = MagicMock()
        mock_session.return_value.client.return_value = mock_client
        mock_client.receive_message.return_value = {"Messages": ["msg1"]}
        from queues.sqs import SQSQueue
        from models.queue_sqs_config import QueueSqsConfig
        config = QueueSqsConfig(
            queue_url="https://sqs.us-east-1.amazonaws.com/123/queue",
            aws_access_key_id="key",
            aws_secret_access_key="secret",
            queue_name="https://sqs.us-east-1.amazonaws.com/123/queue"
        )
        queue = SQSQueue(config)
        queue.send_message("hello")
        mock_client.send_message.assert_called_once()
        assert queue.receive_message() == "msg1"
        queue.delete_message("receipt")
        mock_client.delete_message.assert_called_once()
        mock_client.get_queue_attributes.return_value = {"Attributes": {"ApproximateNumberOfMessages": "5"}}
        assert queue.get_message_count() == "5"

# Test AzureQueueClient (mocked)
def test_azure_queue_client():
    from unittest.mock import patch, MagicMock
    from queues.factory import create_queue_client, get_queue
    from models.queue_azure_config import QueueAzureConfig
    with patch("azure.storage.queue.QueueClient.from_connection_string") as mock_from_conn:
        mock_sdk_client = MagicMock()
        mock_from_conn.return_value = mock_sdk_client
        config = QueueAzureConfig(
            name="az",
            connection_string="DefaultEndpointsProtocol=https;AccountName=dummy;AccountKey=dGVzdGtleQ==;EndpointSuffix=core.windows.net",
            queue_name="q",
            region_name="us-west-2"
        )
        create_queue_client(config)
        queue = get_queue("az")
        with patch.object(queue, "send_message") as mock_send, \
             patch.object(queue, "receive_message", return_value="azmsg") as mock_recv, \
             patch.object(queue, "delete_message") as mock_del, \
             patch.object(queue, "get_message_count", return_value=7) as mock_count:
            queue.send_message("msg")
            mock_send.assert_called_once_with("msg")
            assert queue.receive_message() == "azmsg"
            queue.delete_message("id")
            mock_del.assert_called_once_with("id")
            assert queue.get_message_count() == 7

# Test get_queue_client for local and noop
def test_get_queue_client_local_and_noop():
    from models.queue_local_config import QueueLocalConfig
    from queues.local import LocalQueue
    from queues.noop import NoOpQueue
    from queues.factory import create_queue_client, get_queue

    local_cfg = QueueLocalConfig(name="local1")
    create_queue_client(local_cfg)
    q1 = get_queue("local1")
    assert isinstance(q1, LocalQueue)

    # For NoOpQueue, instantiate directly and add to _queues for singleton test
    from queues.factory import _queues
    no_op = NoOpQueue(config={})
    _queues["noop1"] = no_op
    assert isinstance(_queues["noop1"], NoOpQueue)
    q2 = get_queue("noop1")
    assert isinstance(q2, NoOpQueue)
    # Singleton behavior
    assert get_queue("local1") is q1
    assert get_queue("noop1") is q2


# Demonstration: create and use a queue (developer flow)
def test_queue_creation_and_usage_flow():
    from models.queue_local_config import QueueLocalConfig
    from queues.factory import create_queue_client, get_queue
    from queues.local import LocalQueue

    # Step 1: Create a config and register the queue
    config = QueueLocalConfig(name="demoqueue")
    create_queue_client(config)

    # Step 2: Retrieve the queue instance
    queue = get_queue("demoqueue")
    assert isinstance(queue, LocalQueue)

    # Step 3: Use the queue
    queue.send_message("first")
    queue.send_message("second")
    assert queue.get_message_count() == 2
    assert queue.receive_message() == "first"
    assert queue.receive_message() == "second"
    assert queue.receive_message() is None
