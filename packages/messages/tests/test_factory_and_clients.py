import logging
from messages.interface import MessageConfig
from messages.local import MessagesLocalConfig, LocalMessageClient
from messages.factory import create_message_client, get_message_client
from messages import ERROR


def test_create_local_client_singleton():
    # simulate application startup: register the client (returns None)
    cfg = MessagesLocalConfig(name="dev", use_print=True)
    create_message_client(cfg)

    # later in the app retrieve the created client
    client1 = get_message_client("dev")
    assert client1 is not None

    # registering again is a no-op; retrieval should return the same instance
    create_message_client(cfg)
    client2 = get_message_client("dev")
    assert client1 is client2


def test_local_client_send(capfd):
    # register at startup
    cfg = MessagesLocalConfig(name="dev2", use_print=True)
    create_message_client(cfg)

    # at runtime retrieve the client
    client = get_message_client("dev2")
    assert client is not None

    # send content first, recipient as keyword (avoid accidental assignment to level)
    client.send_message("hello world", recipient="me")
    out = capfd.readouterr().out
    assert "hello world" in out


def test_local_client_logging(caplog):
    cfg = MessagesLocalConfig(name="dev3", use_print=False, logger_name="messages.test")
    create_message_client(cfg)
    client = get_message_client("dev3")
    assert client is not None

    # capture global ERROR level to avoid relying on logger configuration specifics
    with caplog.at_level(logging.ERROR):
        # content, level (MessageLevel enum), recipient (positional)
        client.send_message("bad stuff", ERROR, "me")
    assert any("bad stuff" in rec.message for rec in caplog.records)
