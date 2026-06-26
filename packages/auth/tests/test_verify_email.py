import tempfile
import os
import pytest
from unittest.mock import patch, MagicMock
from auth.verify_email import send_verification_email, send_reset_password_email

class DummyConfig:
    smtp_user = "user"
    smtp_password = "pass"
    smtp_host = "smtp.example.com"
    smtp_port = 587
    smtp_from = "noreply@example.com"
    base_url = "https://example.com"
    verify_email_url = "verify/{registration.verification_token}"
    reset_password_url = "reset/{reset_token}"

def test_send_verification_email_sends_email():
    config = DummyConfig()
    registration = type('Registration', (), {
        'email': 'test@example.com',
        'verification_token': 'abc123',
        'created': 1234567890,
        'client_base_url': 'http://localhost:3000',
    })()
    with patch("smtplib.SMTP") as mock_smtp:
        smtp_instance = MagicMock()
        mock_smtp.return_value.__enter__.return_value = smtp_instance
        send_verification_email(config, registration)
        smtp_instance.starttls.assert_called_once()
        smtp_instance.login.assert_called_once_with(config.smtp_user, config.smtp_password)
        smtp_instance.send_message.assert_called_once()
        # Check that the verification link is in the email body
        sent_msg = smtp_instance.send_message.call_args[0][0]
        assert registration.verification_token in sent_msg.get_content()
        assert config.verify_email_url.split("{")[0] in sent_msg.get_content()

def test_send_reset_password_email_sends_email():
    config = DummyConfig()
    user_email = "reset@example.com"
    token = "reset456"
    with patch("smtplib.SMTP") as mock_smtp:
        smtp_instance = MagicMock()
        mock_smtp.return_value.__enter__.return_value = smtp_instance
        send_reset_password_email(config, user_email, token)
        smtp_instance.starttls.assert_called_once()
        smtp_instance.login.assert_called_once_with(config.smtp_user, config.smtp_password)
        smtp_instance.send_message.assert_called_once()
        sent_msg = smtp_instance.send_message.call_args[0][0]
        assert token in sent_msg.get_content()
        assert config.reset_password_url.split("{")[0] in sent_msg.get_content()
