# managed
"""Tests for error_util module — global / validation exception handlers and
setup. Mirrors the test_response_util style; per-app instances are seeded
once at create_app time (replace=False) so app authors can extend without
losing edits on regen.

Uses `asyncio.run` rather than `pytest-asyncio` so the template doesn't
introduce a new dev dep across the 9 apps that inherit it.

History note: an earlier version of this template tested
`log_exception` + `create_error_response`. The refactor on 2026-05
replaced those with FastAPI-native exception handlers, and the matching
test template was removed. These tests cover the current API:
`global_exception_handler`, `validation_exception_handler`,
`setup_error_handlers`.
"""
import asyncio
import json
from unittest.mock import Mock, patch

import pytest
from fastapi import FastAPI, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from robotlab_x.error_util import (
    global_exception_handler,
    validation_exception_handler,
    setup_error_handlers,
    _jsonable_errors,
)


# ── global_exception_handler ─────────────────────────────────────────────────


class TestGlobalExceptionHandler:
    """500-class catch-all. Returns the raw exception message in debug mode,
    a generic string otherwise. Always 500 and always JSON."""

    @patch("robotlab_x.error_util.get_settings")
    def test_returns_500(self, mock_get_settings):
        mock_get_settings.return_value = Mock(debug=False)
        response = asyncio.run(global_exception_handler(Mock(), ValueError("boom")))
        assert isinstance(response, JSONResponse)
        assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR

    @patch("robotlab_x.error_util.get_settings")
    def test_debug_mode_exposes_exception_message(self, mock_get_settings):
        mock_get_settings.return_value = Mock(debug=True)
        response = asyncio.run(global_exception_handler(Mock(), ValueError("boom-detail")))
        body = json.loads(response.body)
        assert body == {"detail": "boom-detail"}

    @patch("robotlab_x.error_util.get_settings")
    def test_production_mode_hides_exception_message(self, mock_get_settings):
        mock_get_settings.return_value = Mock(debug=False)
        response = asyncio.run(global_exception_handler(Mock(), ValueError("boom-detail")))
        body = json.loads(response.body)
        # Generic message — no internal detail leaks to the caller.
        assert body == {"detail": "An unexpected internal error occurred."}
        assert "boom-detail" not in response.body.decode()

    @patch("robotlab_x.error_util.get_settings")
    def test_missing_debug_attribute_defaults_safe(self, mock_get_settings):
        # spec=[] strips every attribute, so getattr(settings, "debug", False)
        # exercises the safe default and we stay in production mode.
        mock_get_settings.return_value = Mock(spec=[])
        response = asyncio.run(global_exception_handler(Mock(), RuntimeError("oops")))
        body = json.loads(response.body)
        assert body == {"detail": "An unexpected internal error occurred."}

    @patch("robotlab_x.error_util.logger")
    @patch("robotlab_x.error_util.get_settings")
    def test_logs_with_traceback(self, mock_get_settings, mock_logger):
        # exc_info=True is what gets the traceback into the log — important
        # for debugging 500s in production where the response body is generic.
        mock_get_settings.return_value = Mock(debug=False)
        asyncio.run(global_exception_handler(Mock(), ValueError("boom")))
        mock_logger.error.assert_called_once()
        kwargs = mock_logger.error.call_args.kwargs
        assert kwargs.get("exc_info") is True


# ── validation_exception_handler ─────────────────────────────────────────────


class TestValidationExceptionHandler:
    """422-class for Pydantic / FastAPI request-validation failures. Echoes
    the structured `exc.errors()` payload so the client can map back to the
    offending fields."""

    def test_returns_422(self):
        exc = RequestValidationError(errors=[])
        response = asyncio.run(validation_exception_handler(Mock(), exc))
        assert isinstance(response, JSONResponse)
        assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT

    def test_body_contains_errors_list(self):
        sample_errors = [
            {"loc": ["body", "name"], "msg": "field required", "type": "value_error.missing"},
        ]
        exc = RequestValidationError(errors=sample_errors)
        response = asyncio.run(validation_exception_handler(Mock(), exc))
        body = json.loads(response.body)
        assert body["detail"] == sample_errors

    def test_empty_errors_list_still_renders(self):
        exc = RequestValidationError(errors=[])
        response = asyncio.run(validation_exception_handler(Mock(), exc))
        body = json.loads(response.body)
        assert body == {"detail": []}

    @patch("robotlab_x.error_util.logger")
    def test_logs_at_warning_level(self, mock_logger):
        # Validation errors are caller-side problems, not server bugs — warn
        # not error so they don't trigger paging or fail SLO budgets.
        exc = RequestValidationError(errors=[{"loc": ["x"], "msg": "bad", "type": "t"}])
        asyncio.run(validation_exception_handler(Mock(), exc))
        mock_logger.warning.assert_called_once()

    def test_bytes_input_is_decoded_before_serialization(self):
        # Pydantic puts the raw body under err["input"]. When a client sends a
        # non-JSON body to a JSON endpoint, that input arrives as bytes — which
        # json.dumps can't serialize. The handler must defensively decode it so
        # a 422 stays a 422 instead of becoming a 500.
        exc = RequestValidationError(errors=[{
            "loc": ["body"], "msg": "expected JSON", "type": "value_error",
            "input": b"not-json",
        }])
        response = asyncio.run(validation_exception_handler(Mock(), exc))
        body = json.loads(response.body)
        assert body["detail"][0]["input"] == "not-json"

    def test_invalid_utf8_bytes_input_does_not_crash(self):
        # `errors="replace"` keeps us safe even when the raw bytes aren't UTF-8.
        exc = RequestValidationError(errors=[{
            "loc": ["body"], "msg": "x", "type": "y",
            "input": b"\xff\xfe\x00not-utf8",
        }])
        response = asyncio.run(validation_exception_handler(Mock(), exc))
        body = json.loads(response.body)
        # The bytes are decoded (with replacement chars), not raised on.
        assert isinstance(body["detail"][0]["input"], str)


class TestJsonableErrors:
    """Direct tests for the _jsonable_errors helper — exhaustive about the
    bytes-input edge case because that's the path that previously turned 422s
    into 500s."""

    def test_passthrough_when_no_bytes(self):
        errors = [{"loc": ["body", "name"], "msg": "field required", "type": "missing"}]
        assert _jsonable_errors(errors) == errors

    def test_decodes_bytes_input(self):
        errors = [{"loc": ["body"], "msg": "bad", "type": "x", "input": b"hello"}]
        out = _jsonable_errors(errors)
        assert out[0]["input"] == "hello"
        # Original errors must not be mutated — handler is called once per request
        # and the source list may belong to the exception object.
        assert errors[0]["input"] == b"hello"

    def test_handles_invalid_utf8_with_replacement(self):
        errors = [{"input": b"\xff\xfe"}]
        out = _jsonable_errors(errors)
        assert isinstance(out[0]["input"], str)

    def test_leaves_non_bytes_input_alone(self):
        # str / dict / list / None all pass through unchanged.
        errors = [
            {"input": "already-str"},
            {"input": {"key": "val"}},
            {"input": ["a", "b"]},
            {"input": None},
            {},
        ]
        out = _jsonable_errors(errors)
        assert out[0]["input"] == "already-str"
        assert out[1]["input"] == {"key": "val"}
        assert out[2]["input"] == ["a", "b"]
        assert out[3]["input"] is None
        assert "input" not in out[4]


# ── setup_error_handlers ─────────────────────────────────────────────────────


class TestSetupErrorHandlers:
    """Wiring test — confirms both handlers actually attach and fire when a
    matching exception is raised inside a real FastAPI app."""

    def test_registers_both_handlers(self):
        app = FastAPI()
        setup_error_handlers(app)
        # FastAPI stores exception_handlers as {ExceptionType: handler}.
        # Both handlers should be present.
        assert Exception in app.exception_handlers
        assert RequestValidationError in app.exception_handlers
        assert app.exception_handlers[Exception] is global_exception_handler
        assert app.exception_handlers[RequestValidationError] is validation_exception_handler

    @patch("robotlab_x.error_util.get_settings")
    def test_global_handler_catches_uncaught_exception_in_route(self, mock_get_settings):
        mock_get_settings.return_value = Mock(debug=True)
        app = FastAPI()
        setup_error_handlers(app)

        @app.get("/boom")
        def boom():
            raise ValueError("kaboom")

        # TestClient with raise_server_exceptions=False routes the unhandled
        # error through our handler instead of bubbling it out of the test.
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/boom")
        assert response.status_code == 500
        assert response.json() == {"detail": "kaboom"}

    def test_validation_handler_catches_bad_request_body(self):
        from pydantic import BaseModel

        class Payload(BaseModel):
            name: str
            count: int

        app = FastAPI()
        setup_error_handlers(app)

        @app.post("/echo")
        def echo(p: Payload):
            return p

        client = TestClient(app)
        response = client.post("/echo", json={"name": "x"})  # missing 'count'
        assert response.status_code == 422
        body = response.json()
        assert "detail" in body
        assert any(
            "count" in (err.get("loc") or [])
            for err in body["detail"]
        )

    def test_non_json_body_produces_422_not_500(self):
        # Regression: posting a non-JSON body to a JSON endpoint used to cause a
        # 500 because Pydantic put the raw bytes into err["input"] and the
        # default JSONResponse couldn't serialize them. _jsonable_errors decodes
        # the bytes so the 422 path renders cleanly.
        from pydantic import BaseModel

        class Payload(BaseModel):
            name: str

        app = FastAPI()
        setup_error_handlers(app)

        @app.post("/echo")
        def echo(p: Payload):
            return p

        client = TestClient(app, raise_server_exceptions=False)
        response = client.post(
            "/echo",
            content=b"this is not json",
            headers={"Content-Type": "text/plain"},
        )
        assert response.status_code == 422, (
            f"expected 422 (validation), got {response.status_code} — "
            "non-JSON body should fall through validation, not crash serialization"
        )
        body = response.json()
        assert "detail" in body
