from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr

class MessagesGoogleChatConfig(BaseModel):
    id: Optional[str] = Field("default", json_schema_extra={"example":"default"})
    name: Optional[str] = Field("default", json_schema_extra={"example":"messages"})
    prefix: Optional[str] = Field("", description="prefix all messages with this", json_schema_extra={"example":"messages"})
    webhook_url: Optional[str] = Field(None, description="Google Chat Config Webhook URL", json_schema_extra={"example":"https://chat.googleapis.com/v1/spaces/AAAA.../messages?key=..."})

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load MessagesGoogleChatConfig from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load MessagesGoogleChatConfig from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load MessagesGoogleChatConfig from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load MessagesGoogleChatConfig from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
