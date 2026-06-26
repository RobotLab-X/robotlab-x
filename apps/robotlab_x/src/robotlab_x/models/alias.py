from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr

class Alias(BaseModel):
    id: Optional[str] = Field(None, description="Primary key - set to workspace_id/name on create", json_schema_extra={"example":"vision-pipeline/vision"})
    workspace_id: str = Field(..., description="Parent workspace name", json_schema_extra={"example":"vision-pipeline"})
    name: str = Field(..., description="The alias short name used in message routing", json_schema_extra={"example":"vision"})
    target_type: str = Field(..., description="What the alias resolves to - service_proxy, topic, or subscription", json_schema_extra={"example":"service_proxy"})
    target_id: str = Field(..., description="The actual id of the target being aliased", json_schema_extra={"example":"pycv"})
    description: Optional[str] = Field(None, description="Human-readable explanation of this alias mapping")

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load Alias from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load Alias from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load Alias from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load Alias from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
