# managed
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr


class LogEvent(BaseModel):
    id: Optional[str] = Field(None, json_schema_extra={"example":"01HK4D8X4P7Y2N6V3M9Q1R5S8T"}, description="Log event id (ULID or UUID).")
    ts: Optional[str] = Field(None, json_schema_extra={"example":"2026-05-25T18:00:00.123Z"}, description="ISO-8601 UTC timestamp when the record was emitted by the logger.")
    service: Optional[str] = Field(None, json_schema_extra={"example":"cannamatic"}, description="Service name (matches the FastAPI app name).")
    level: Optional[Literal["DEBUG","INFO","WARNING","ERROR","CRITICAL"]] = Field("INFO", json_schema_extra={"example":"INFO"}, description="Python logging level name.")
    logger: Optional[str] = Field(None, json_schema_extra={"example":"cannamatic.services.intake_session_service"}, description="Python logger name (dotted module path).")
    message: Optional[str] = Field(None, json_schema_extra={"example":"intake session 8b29-… moved to stage=collection"}, description="Formatted log message.")
    tenant_id: Optional[str] = Field(None, json_schema_extra={"example":"demo-local"}, description="Tenant in scope when the record was emitted (null for system-wide events).")
    user_id: Optional[str] = Field(None, json_schema_extra={"example":"demo@cannamatic.io"}, description="Email/id of the authenticated user, if any.")
    request_id: Optional[str] = Field(None, json_schema_extra={"example":"req_a1b2c3"}, description="Per-request id from the X-Request-ID middleware. Links every log line for the same HTTP request.")
    method: Optional[str] = Field(None, json_schema_extra={"example":"POST"}, description="HTTP method when the record was emitted inside a request handler.")
    path: Optional[str] = Field(None, json_schema_extra={"example":"/v1/intake-session"}, description="HTTP request path when known.")
    status_code: Optional[int] = Field(None, json_schema_extra={"example":200}, description="HTTP status if the record was emitted after the response was determined.")
    context: Optional[dict[str, Any]] = Field(None, description="Structured extra context — anything passed via logger.x(..., extra={...}). JSONB column.", json_schema_extra={"example":{"session_id":"99e38114-4a53-425f-86fe-b3d3670c098e","duration_ms":42}})
    traceback: Optional[str] = Field(None, description="Full exception traceback for ERROR/CRITICAL records; null otherwise.", json_schema_extra={"example":"Traceback (most recent call last):\n  File ..."})
