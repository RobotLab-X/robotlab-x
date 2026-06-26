from pydantic import BaseModel, Field
from typing import Any, Optional, Literal
from datetime import datetime, timezone
from uuid import UUID, uuid4

class Message(BaseModel):
    # FIXME - None id default only when blocking or requested
    id: UUID = Field(default_factory=uuid4, description="A unique UUID identifier for the message")
    name: str = Field(..., description="The destination service name")
    src: str = Field(..., description="Source of the message")
    method: str = Field(..., description="The method related to the message")
    encoding: Optional[str] = Field(None, description="Encoding of the message")
    type: Literal["async", "block", "stream"] = Field(..., description="Message type: 'async' or 'block'")
    data: Optional[Any] = Field(None, description="Payload that can contain any type or be None")
    ts: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="Timestamp of the message in UTC")
