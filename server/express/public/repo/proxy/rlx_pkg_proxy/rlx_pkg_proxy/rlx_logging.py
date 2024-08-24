import logging
import json
import os
from typing import Optional

class JsonFormatter(logging.Formatter):
    def format(self, record):
        log_record = {
            'ts': int(record.created),  # Convert the timestamp to epoch time and rename to 'ts'
            'level': record.levelname.lower(),  # Convert the log level to lowercase
            'msg': record.getMessage(),  # Rename 'message' to 'msg'
            'module': record.name,  # Replace 'name' with 'module'
            'filename': os.path.basename(record.pathname),  # Use only the filename
            'lineno': record.lineno,
        }
        return json.dumps(log_record)

class Logging:
    _instance = None
    _loggers = {}

    def __new__(cls, id: Optional[str] = None):
        if cls._instance is None:
            cls._instance = super(Logging, cls).__new__(cls)
            cls._instance._initialized = False
            if id is None:
                raise ValueError("An 'id' must be provided when creating the Logging singleton.")
            cls._instance.log_file_path = f"{id}.log"
        return cls._instance

    def __init__(self, id: Optional[str] = None):
        if self._initialized:
            return
        self._initialized = True
        self.base_logger = self.setup_logging(self.log_file_path)

    def setup_logging(self, log_file_path: str):
        logger = logging.getLogger()
        logger.setLevel(logging.INFO)  # Set default logging level to INFO

        # Create a file handler
        file_handler = logging.FileHandler(log_file_path)
        file_handler.setLevel(logging.INFO)  # Set file handler level to INFO

        # Create a custom JSON formatter
        json_formatter = JsonFormatter()
        file_handler.setFormatter(json_formatter)

        # Add the file handler to the logger
        logger.addHandler(file_handler)

        # Optionally, add a console handler
        console_handler = logging.StreamHandler()
        console_handler.setLevel(logging.INFO)  # Set console handler level to INFO
        console_handler.setFormatter(json_formatter)
        logger.addHandler(console_handler)

        return logger

    def get_logger(self, service_name: str):
        if service_name in self._loggers:
            return self._loggers[service_name]

        # Create a new logger for the service
        service_logger = logging.getLogger(service_name)
        service_logger.setLevel(logging.INFO)  # Set default logging level to INFO

        # Use the existing handlers of the base logger
        for handler in self.base_logger.handlers:
            service_logger.addHandler(handler)

        # Store the logger for future use
        self._loggers[service_name] = service_logger
        return service_logger
