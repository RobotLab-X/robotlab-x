from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr

class MessagesSlackConfig(BaseModel):
    id: Optional[str] = Field("default", json_schema_extra={"example":"default"})
    name: Optional[str] = Field("default", json_schema_extra={"example":"messages"})
    prefix: Optional[str] = Field("", description="prefix all messages with this", json_schema_extra={"example":"messages"})
    channel: Optional[str] = Field(None, description="Default Slack Channel", json_schema_extra={"example":"#general"})
    slack_token: Optional[str] = Field(None, description="Slack Bot Token", json_schema_extra={"example":"xoxb-1234-abcdefg..."})

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load MessagesSlackConfig from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load MessagesSlackConfig from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load MessagesSlackConfig from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load MessagesSlackConfig from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
