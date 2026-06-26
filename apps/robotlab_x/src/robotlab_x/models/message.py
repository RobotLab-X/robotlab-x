from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr

class Message(BaseModel):
    id: Optional[str] = Field(None, description="Transcription Request ID - can be created by client or will be self generated", json_schema_extra={"example":"123e4567-e89b-12d3-a456-426614174000"})
    name: Optional[str] = Field(None, description="the unique service name / topic — None would be simple broadcast", json_schema_extra={"example":"ollama@rbx.com"})
    type: Optional[str] = Field(None, description="service")
    method: str = Field(None, description="the method to be invoked on the service", json_schema_extra={"example":"visit-1234"})
    data: Optional[dict] = Field(None, description="the data to be sent to the service", json_schema_extra={"type":"object","additionalProperties":True,"example":{"key":"value"}})
    reply_to: Optional[str] = Field(None, description="the message ID to reply to for request-response patterns", json_schema_extra={"example":"123e4567-e89b-12d3-a456-426614174000"})

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load Message from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load Message from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load Message from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load Message from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
