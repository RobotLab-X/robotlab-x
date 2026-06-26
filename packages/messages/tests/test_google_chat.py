import logging
import pytest
from unittest.mock import patch, MagicMock
from messages import create_message_client, get_message_client, ERROR, SUCCESS
from messages.google_chat import MessagesGoogleChatConfig, GoogleChatClient


def test_google_chat_send_prefix_and_raise_on_error():
    cfg = MessagesGoogleChatConfig(name="ops", webhook_url="https://example.com/webhook")
    client = GoogleChatClient(cfg)

    with patch("messages.google_chat.requests.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.raise_for_status.side_effect = Exception("boom")
        mock_post.return_value = mock_resp

        with pytest.raises(Exception):
            client.send_message("something bad", level=ERROR)

        # ensure network call was made
        assert mock_post.called, "expected requests.post to be called"
        args, kwargs = mock_post.call_args
        assert "json" in kwargs
        assert "[ERROR]" in kwargs["json"]["text"]


def test_google_chat_success():
    cfg = MessagesGoogleChatConfig(name="ops", webhook_url="https://example.com/webhook")
    client = GoogleChatClient(cfg)

    with patch("messages.google_chat.requests.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.raise_for_status.return_value = None
        mock_post.return_value = mock_resp

        client.send_message("ok message", level=ERROR)
        assert mock_post.called
        args, kwargs = mock_post.call_args
        assert kwargs["json"]["text"].startswith("[ERROR]")


def test_google_chat_send_and_prefix():
    cfg = MessagesGoogleChatConfig(name="gc1", webhook_url="https://example.com/webhook")
    create_message_client(cfg)
    client = get_message_client("gc1")

    with patch("messages.google_chat.requests.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.raise_for_status.return_value = None
        mock_post.return_value = mock_resp

        client.send_message("ok")

        # ensure the mocked post was called before inspecting call args
        assert mock_post.called
        args, kwargs = mock_post.call_args
        assert kwargs["json"]["text"] == "[INFO] ℹ️  ok"

        client.send_message("yay", SUCCESS)
        assert mock_post.call_count >= 2
        args, kwargs = mock_post.call_args
        assert kwargs["json"]["text"].startswith("[SUCCESS]")
