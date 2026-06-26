# managed
"""Tests for service_response module."""
import pytest
from robotlab_x.service_response import (
    MessageType,
    ServiceResponseMessage,
    create_message,
    debug_message,
    info_message,
    warning_message,
    error_message
)


class TestServiceResponseMessage:
    """Test ServiceResponseMessage model."""

    def test_service_response_message_creation(self):
        """Test creating a ServiceResponseMessage."""
        msg = ServiceResponseMessage(
            id="test-123",
            type=MessageType.INFO,
            status_code=200,
            message="Test message",
            detail={"key": "value"}
        )
        assert msg.id == "test-123"
        assert msg.type == MessageType.INFO
        assert msg.status_code == 200
        assert msg.message == "Test message"
        assert msg.detail == {"key": "value"}

    def test_service_response_message_optional_fields(self):
        """Test ServiceResponseMessage with optional fields."""
        msg = ServiceResponseMessage()
        assert msg.id is None
        assert msg.type is None
        assert msg.status_code is None
        assert msg.message is None
        assert msg.detail is None


class TestMessageType:
    """Test MessageType enum."""

    def test_message_type_values(self):
        """Test MessageType enum values."""
        assert MessageType.DEBUG == "debug"
        assert MessageType.INFO == "info"
        assert MessageType.ERROR == "error"
        assert MessageType.WARNING == "warning"


class TestCreateMessage:
    """Test create_message function."""

    def test_create_message_with_all_params(self):
        """Test creating message with all parameters."""
        msg = create_message(
            MessageType.INFO,
            "Test message",
            status_code=200,
            detail="Details here",
            id="msg-123"
        )
        assert msg.type == MessageType.INFO
        assert msg.message == "Test message"
        assert msg.status_code == 200
        assert msg.detail == "Details here"
        assert msg.id == "msg-123"

    def test_create_message_with_minimal_params(self):
        """Test creating message with minimal parameters."""
        msg = create_message(MessageType.ERROR, "Error occurred")
        assert msg.type == MessageType.ERROR
        assert msg.message == "Error occurred"
        assert msg.status_code is None
        assert msg.detail is None
        assert msg.id is None


class TestDebugMessage:
    """Test debug_message function."""

    def test_debug_message_default(self):
        """Test debug message with default status code."""
        msg = debug_message("Debug info")
        assert msg.type == MessageType.DEBUG
        assert msg.message == "Debug info"
        assert msg.status_code == 200
        assert msg.detail is None

    def test_debug_message_with_detail(self):
        """Test debug message with detail."""
        msg = debug_message("Debug info", status_code=201, detail={"trace": "stack"})
        assert msg.type == MessageType.DEBUG
        assert msg.message == "Debug info"
        assert msg.status_code == 201
        assert msg.detail == {"trace": "stack"}


class TestInfoMessage:
    """Test info_message function."""

    def test_info_message_default(self):
        """Test info message with default status code."""
        msg = info_message("Operation successful")
        assert msg.type == MessageType.INFO
        assert msg.message == "Operation successful"
        assert msg.status_code == 200

    def test_info_message_with_custom_status(self):
        """Test info message with custom status code."""
        msg = info_message("Created", status_code=201)
        assert msg.type == MessageType.INFO
        assert msg.status_code == 201


class TestWarningMessage:
    """Test warning_message function."""

    def test_warning_message_default(self):
        """Test warning message with default status code."""
        msg = warning_message("This is a warning")
        assert msg.type == MessageType.WARNING
        assert msg.message == "This is a warning"
        assert msg.status_code == 299

    def test_warning_message_with_detail(self):
        """Test warning message with detail."""
        msg = warning_message("Warning", status_code=400, detail="validation failed")
        assert msg.type == MessageType.WARNING
        assert msg.status_code == 400
        assert msg.detail == "validation failed"


class TestErrorMessage:
    """Test error_message function."""

    def test_error_message_default(self):
        """Test error message with default status code."""
        msg = error_message("An error occurred")
        assert msg.type == MessageType.ERROR
        assert msg.message == "An error occurred"
        assert msg.status_code == 500

    def test_error_message_with_custom_status(self):
        """Test error message with custom status code."""
        msg = error_message("Not found", status_code=404, detail="Resource missing")
        assert msg.type == MessageType.ERROR
        assert msg.status_code == 404
        assert msg.detail == "Resource missing"
