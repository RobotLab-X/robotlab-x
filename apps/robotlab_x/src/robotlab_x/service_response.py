# managed
import logging
from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel

logger = logging.getLogger(__name__)

class MessageType(str, Enum):
    DEBUG = "debug"
    INFO = "info"
    ERROR = "error"
    WARNING = "warning"

class ServiceResponseMessage(BaseModel):
    id: Optional[str] = None # UUID from original request
    type: Optional[MessageType] = None # info, error, warning, debug
    status_code: Optional[int] = None # 401, 404, 500 etc.
    message: Optional[str] = None # Human-readable message
    detail: Optional[Any] = None # Stack trace, etc.


def create_message(message_type: MessageType, message: str, status_code=None, detail: Any = None, id: str = None) -> ServiceResponseMessage:
    return ServiceResponseMessage(type=message_type, message=message, status_code=status_code, detail=detail, id=id)

def debug_message(message: str, status_code: int = 200,detail: Any = None) -> ServiceResponseMessage:
    logger.info(f"{message} | detail: {detail}")
    return create_message(MessageType.DEBUG, message, status_code, detail)

def info_message(message: str, status_code: int = 200, detail: Any = None) -> ServiceResponseMessage:
    logger.info(f"{message} | detail: {detail}")
    return create_message(MessageType.INFO, message, status_code, detail)

def warning_message(message: str, status_code: int = 299, detail: Any = None) -> ServiceResponseMessage:
    logger.warning(f"{message} | detail: {detail}")
    return create_message(MessageType.WARNING, message, status_code, detail)

def error_message(message: str, status_code: int = 500, detail: Any = None) -> ServiceResponseMessage:
    logger.error(f"{message} | detail: {detail}")
    return create_message(MessageType.ERROR, message, status_code, detail)


# Example Usage
if __name__ == "__main__":
    print(info_message("Operation successful", {"id": 123}).model_dump_json())
    print(error_message("An error occurred").model_dump_json())
    print(warning_message("This is a warning").model_dump_json())
