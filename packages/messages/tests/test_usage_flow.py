import logging
from unittest.mock import patch, MagicMock
import pytest

from messages import create_message_client, get_message_client, ERROR, INFO, SUCCESS
from messages.google_chat import MessagesGoogleChatConfig


def test_popular_use_case_minimal_send_content_only():
    """Most popular: send a simple textual message with no level or recipient."""
    cfg = MessagesGoogleChatConfig(name="msg-service", webhook_url="https://example.com/webhook")
    create_message_client(cfg)
    client = get_message_client("msg-service")
    assert client is not None

    with patch("messages.google_chat.requests.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.raise_for_status.return_value = None
        mock_post.return_value = mock_resp

        client.send_message("This should work!")

        args, kwargs = mock_post.call_args
        assert "json" in kwargs
        assert kwargs["json"]["text"] == "[INFO] ℹ️  This should work!"


def test_second_most_common_use_case_content_with_level_prefixing():
    """Second most common: supply a MessageLevel (e.g. ERROR) to highlight severity."""
    cfg = MessagesGoogleChatConfig(name="msg-service-level", webhook_url="https://example.com/webhook")
    create_message_client(cfg)
    client = get_message_client("msg-service-level")

    with patch("messages.google_chat.requests.post") as mock_post:
        mock_resp = MagicMock()
        # simulate the webhook returning an error so the client raises after logging
        mock_resp.raise_for_status.side_effect = Exception("boom")
        mock_post.return_value = mock_resp

        with pytest.raises(Exception):
            client.send_message("This is an error", ERROR)

        args, kwargs = mock_post.call_args
        assert "json" in kwargs
        assert kwargs["json"]["text"].startswith("[ERROR]")


def test_third_use_case_full_control_content_level_and_recipient():
    """Third most common: full control with content, level, and a recipient identifier."""
    cfg = MessagesGoogleChatConfig(name="msg-service-full", webhook_url="https://example.com/webhook")
    create_message_client(cfg)
    client = get_message_client("msg-service-full")

    with patch("messages.google_chat.requests.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.raise_for_status.return_value = None
        mock_post.return_value = mock_resp

        # recipient is accepted by the client interface; GoogleChat ignores it but apps can use it
        client.send_message("Direct to Fred", level=INFO, recipient="Fred")

        args, kwargs = mock_post.call_args
        assert "json" in kwargs
        assert kwargs["json"]["text"].startswith("[INFO]")
        assert "Direct to Fred" in kwargs["json"]["text"]


# New tests demonstrating the convenience helper methods added to the base MessageClient
def test_convenience_helper_send_error_message():
    """Using the helper method for ERROR-level messages should prefix appropriately."""
    cfg = MessagesGoogleChatConfig(name="msg-service-helper-error", webhook_url="https://example.com/webhook")
    create_message_client(cfg)
    client = get_message_client("msg-service-helper-error")

    with patch("messages.google_chat.requests.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.raise_for_status.return_value = None
        mock_post.return_value = mock_resp

        # use the convenience helper (no explicit level argument)
        client.send_error_message("Helper error occurred")

        args, kwargs = mock_post.call_args
        assert "json" in kwargs
        assert kwargs["json"]["text"].startswith("[ERROR]")
        assert "Helper error occurred" in kwargs["json"]["text"]


def test_convenience_helper_send_success_message_with_recipient():
    """Helper for SUCCESS-level messages with an optional recipient argument."""
    cfg = MessagesGoogleChatConfig(name="msg-service-helper-success", webhook_url="https://example.com/webhook")
    create_message_client(cfg)
    client = get_message_client("msg-service-helper-success")

    with patch("messages.google_chat.requests.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.raise_for_status.return_value = None
        mock_post.return_value = mock_resp

        client.send_success_message("Operation completed", recipient="OpsTeam")

        args, kwargs = mock_post.call_args
        assert "json" in kwargs
        assert kwargs["json"]["text"].startswith("[SUCCESS]")
        assert "Operation completed" in kwargs["json"]["text"]
        # recipient is informational for the caller; GoogleChat payload includes the message text
