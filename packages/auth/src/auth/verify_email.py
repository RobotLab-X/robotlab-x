import smtplib
from email.message import EmailMessage
import uuid
from typing import Protocol
import logging
from database.interface import DatabaseAdapter

logger = logging.getLogger(__name__)

# This is a Non-Optional Config union of the Apps actual config
class EmailVerificationConfig(Protocol):
    smtp_user: str
    smtp_password: str
    smtp_host: str
    smtp_port: int
    smtp_from: str

# example of derived union class for SendGrid
# class EmailVerificationConfigSendGrid(EmailVerificationConfig):
#     smtp_type: str = "sendgrid"
#     smtp_key: str
#     smtp_from: str
#     base_url: str
#     verify_email_url: str = "{config.base_url}/verify-email?token={verification_token}"
#     reset_password_url: str = "{config.base_url}/reset-password?token={reset_token}"

# Non-Option Registration definition
class EmailRegistration(Protocol):
    email: str
    verification_token: str
    created: int
    client_base_url: str

def _render_email_content(template: str, **kwargs) -> str:
    """Helper to render email content with provided variables."""
    return template.format(**kwargs)

# def send_verification_email(config: EmailVerificationConfig, user_email: str, verification_token: str):
def send_verification_email(config: EmailVerificationConfig, registration: EmailRegistration):
    # verification_link = config.verify_email_url.replace("{verification_token}", registration.verification_token).replace("{config.base_url}", config.base_url)
    if not registration.verification_token:
        raise ValueError("verification_token is required to send verification email")
    if not registration.client_base_url:
        raise ValueError("client_base_url is required to send verification email")
    verification_link = config.verify_email_url.replace(
        "{registration.verification_token}",
        registration.verification_token,
    ).replace(
        "{registration.client_base_url}",
        registration.client_base_url,
    )
    subject = "Email Verification"
    content = _render_email_content(
        "Hi,\n\nPlease verify your email by clicking on the following link:\n{verification_link}\n\nThank you!",
        verification_link=verification_link
    )
    if getattr(config, 'smtp_type', 'simple') == 'sendgrid':
        from sendgrid import SendGridAPIClient
        from sendgrid.helpers.mail import Mail
        message = Mail(
            from_email=config.smtp_from,
            to_emails=registration.email,
            subject=subject,
            plain_text_content=content
        )
        try:
            sg = SendGridAPIClient(config.smtp_key)
            response = sg.send(message)
            logger.info(f"Verification email sent successfully via SendGrid: {response.status_code}")
        except Exception as e:
            logger.error(f"Failed to send verification email via SendGrid: {e}")
        return
    # SMTP fallback
    msg = EmailMessage()
    msg.set_content(content)
    msg['Subject'] = subject
    msg['From'] = config.smtp_from
    msg['To'] = registration.email
    try:
        with smtplib.SMTP(config.smtp_host, config.smtp_port, timeout=10) as smtp:
            smtp.ehlo()
            smtp.starttls()
            smtp.login(config.smtp_user, config.smtp_password)
            smtp.send_message(msg)
        logger.info("Verification email sent successfully")
    except Exception as e:
        logger.error(f"Failed to send verification email: {e}")

def send_reset_password_email(config: EmailVerificationConfig, user_email: str, reset_token: str):
    reset_link = config.reset_password_url.replace("{reset_token}", reset_token).replace("{config.base_url}", config.base_url)
    subject = "Password Reset Request"
    content = _render_email_content(
        "Hi,\n\nYou can reset your password by clicking on the following link:\n{reset_link}\n\nIf you did not request this, please ignore this email.\n\nThank you!",
        reset_link=reset_link
    )
    if getattr(config, 'smtp_type', 'simple') == 'sendgrid':
        from sendgrid import SendGridAPIClient
        from sendgrid.helpers.mail import Mail
        message = Mail(
            from_email=config.smtp_from,
            to_emails=user_email,
            subject=subject,
            plain_text_content=content
        )
        try:
            sg = SendGridAPIClient(config.smtp_key)
            response = sg.send(message)
            logger.info(f"Password reset email sent successfully via SendGrid: {response.status_code}")
        except Exception as e:
            logger.error(f"Failed to send password reset email via SendGrid: {e}")
        return
    # SMTP fallback
    msg = EmailMessage()
    msg.set_content(content)
    msg['Subject'] = subject
    msg['From'] = config.smtp_from
    msg['To'] = user_email
    try:
        with smtplib.SMTP(config.smtp_host, config.smtp_port, timeout=10) as smtp:
            smtp.ehlo()
            smtp.starttls()
            smtp.login(config.smtp_user, config.smtp_password)
            smtp.send_message(msg)
        logger.info("Password reset email sent successfully")
    except Exception as e:
        logger.error(f"Failed to send password reset email: {e}")
