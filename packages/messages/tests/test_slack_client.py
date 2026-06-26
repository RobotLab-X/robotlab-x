import pytest
from unittest.mock import patch, MagicMock

from messages import create_message_client, get_message_client, ERROR, INFO, SUCCESS
from messages.slack import MessagesSlackConfig


def test_slack_send_and_prefix_and_channel_and_recipient():
    cfg = MessagesSlackConfig(name="slack1", webhook_url="https://example.com/webhook", channel="#alerts")
    create_message_client(cfg)
    client = get_message_client("slack1")

    with patch("slack_sdk.WebClient.chat_postMessage") as mock_post:
        mock_post.return_value = MagicMock()

        # simple send
        client.send_message("hello")
        assert mock_post.called
        args, kwargs = mock_post.call_args
        assert kwargs["channel"] == "#alerts"
        assert kwargs["text"] == "[INFO] ℹ️  hello"
        # channel override present in payload

        # success level prefix
        client.send_message("It worked", SUCCESS)
        assert mock_post.call_count >= 2
        args, kwargs = mock_post.call_args
        assert kwargs["text"].startswith("[SUCCESS]")

        # recipient appended into text and level prefix applied
        client.send_message("Ping", level=INFO, recipient="alice")
        args, kwargs = mock_post.call_args
        assert kwargs["text"].startswith("[INFO]")
        assert "(to alice)" in kwargs["text"]


def test_slack_convenience_helper_send_error_message():
    cfg = MessagesSlackConfig(name="slack-helper", webhook_url="https://example.com/webhook", channel="#alerts")
    create_message_client(cfg)
    client = get_message_client("slack-helper")

    with patch("slack_sdk.WebClient.chat_postMessage") as mock_post:
        mock_post.return_value = MagicMock()

        client.send_error_message("Something broke")
        assert mock_post.called
        args, kwargs = mock_post.call_args
        assert kwargs["text"].startswith("[ERROR]")
        assert "Something broke" in kwargs["text"]
