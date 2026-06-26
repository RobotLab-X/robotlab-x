import logging
import pytest
from messages.local import MessagesLocalConfig, LocalMessageClient
from messages import WARNING


def test_local_print_capability(capfd):
    cfg = MessagesLocalConfig(name="test", use_print=True)
    client = LocalMessageClient(cfg)
    # content first, recipient as keyword
    client.send_message("hello world", recipient="me")
    captured = capfd.readouterr()
    assert "hello world" in captured.out


def test_local_level_logging(caplog):
    cfg = MessagesLocalConfig(name="test", use_print=False, logger_name="messages.test")
    client = LocalMessageClient(cfg)
    with caplog.at_level(logging.WARNING, logger="messages.test"):
        # content first, level as messages.WARNING enum, recipient as keyword
        client.send_message("warned", level=WARNING, recipient="me")
    assert any("warned" in rec.message for rec in caplog.records)
