from typing import List, Optional, Any

class Message:
    """
    Message class represents a message with various attributes.

    Attributes:
        msgId: Unique identifier of the message.
        type: Type of message (e.g., synchronous service call == service).
        gatewayId: Internal identifier for the client that sent the message.
        gateway: The immediate local gateway the message came in from.
        name: Name of the service the message is addressed to.
        method: Name of the method to invoke.
        sender: Full name of the service that sent the message.
        data: Array of data to pass as arguments to the method.
    """

    def __init__(self, name: Optional[str] = None, method: Optional[str] = None, data: Optional[List[Any]] = None):
        self.msgId: Optional[str] = None
        self.type: Optional[str] = None
        self.gatewayId: Optional[str] = None
        self.gateway: Optional[str] = None
        self.name: Optional[str] = name
        self.method: Optional[str] = method
        self.sender: Optional[str] = None
        self.data: Optional[List[Any]] = data if data is not None else []

