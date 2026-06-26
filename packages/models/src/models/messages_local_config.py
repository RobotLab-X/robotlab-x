from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr

class MessagesLocalConfig(BaseModel):
    id: Optional[str] = Field("default", json_schema_extra={"example":"default"})
    name: Optional[str] = Field("default", json_schema_extra={"example":"messages"})
    prefix: Optional[str] = Field("", description="prefix all messages with this", json_schema_extra={"example":"messages"})
    logger_name: Optional[str] = Field(None, description="Local Config Logger Name", json_schema_extra={"example":"my_logger"})
    use_print: Optional[bool] = Field(True, description="Use print for Local Config", json_schema_extra={"example":True})
    buffer_messages: Optional[bool] = Field(False, description="Buffer messages in memory", json_schema_extra={"example":False})

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load MessagesLocalConfig from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load MessagesLocalConfig from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load MessagesLocalConfig from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load MessagesLocalConfig from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
