from enum import Enum


class MessageLevel(Enum):
    """Message-level enum used by the messages package.

    This is intentionally simple and maps to the common logging level names.
    Implementations may map these to logging levels or other semantics.
    """
    DEBUG = "DEBUG"
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"
    CRITICAL = "CRITICAL"
    SUCCESS = "SUCCESS"


# Convenience constants so callers can write `from messages import ERROR` and pass
# the enum member directly as a clean, minimal literal in sample code/tests.
DEBUG = MessageLevel.DEBUG
INFO = MessageLevel.INFO
WARNING = MessageLevel.WARNING
ERROR = MessageLevel.ERROR
CRITICAL = MessageLevel.CRITICAL
SUCCESS = MessageLevel.SUCCESS
