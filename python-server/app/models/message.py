from typing import Optional, List, Any
from pydantic import BaseModel, Field

class Message(BaseModel):
    """
    Message data model equivalent to server/src/express/models/Message.ts
    """
    msgId: Optional[str] = Field(
        default=None, description="Message ID - unique identifier of message. Required only when synchronous communication is required."
    )
    type: Optional[str] = Field(
        default=None, description="Message type (e.g. synchronous service call == service)"
    )
    gatewayId: Optional[str] = Field(
        default=None, description='"Internal" identifier for the client that sent the message, set by the process that is processing the message.'
    )
    gateway: Optional[str] = Field(
        default=None, description="Immediate local gateway the message came in from, if from a remote process."
    )
    name: Optional[str] = Field(
        default=None, description="Service name - name of the service the message is addressed to."
    )
    method: Optional[str] = Field(
        default=None, description="Method name - name of the method to invoke."
    )
    sender: Optional[str] = Field(
        default=None, description="Sender - full name of the service that sent the message."
    )
    data: Optional[List[Any]] = Field(
        default=None, description="Array of data to pass as arguments to the method."
    )
