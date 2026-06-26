from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr

class Script(BaseModel):
    id: Optional[str] = Field(None, description="Primary key - UUID auto-generated on create", json_schema_extra={"example":"script-123"})
    name: str = Field(..., description="Human-readable name for this script", json_schema_extra={"example":"hello-world"})
    language: Literal["python"] = Field("python", description="Script language (Python only in Phase 5; more in later phases)", json_schema_extra={"example":"python"})
    body: Optional[str] = Field("", description="Source code of the script", json_schema_extra={"example":"print('hello')"})
    created_at: Optional[str] = Field(None, description="ISO-8601 timestamp when the script was created")
    updated_at: Optional[str] = Field(None, description="ISO-8601 timestamp when the script was last saved")

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load Script from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load Script from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load Script from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load Script from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
