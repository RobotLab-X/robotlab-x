from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr

class ServiceConfig(BaseModel):
    id: Optional[str] = Field(None, description="Primary key - set to service_proxy_id on create", json_schema_extra={"example":"pycv"})
    service_proxy_id: str = Field(..., description="Foreign key - name of the owning service_proxy", json_schema_extra={"example":"pycv"})
    service_meta_id: str = Field(..., description="Denormalized reference to the service catalog entry", json_schema_extra={"example":"opencv@4.8.0"})
    params: Optional[dict] = Field(None, description="Flexible per-instance configuration - structure varies by service type", json_schema_extra={"type":"object","additionalProperties":True,"example":{"resolution":"1920x1080","fps":30}})

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load ServiceConfig from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load ServiceConfig from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load ServiceConfig from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load ServiceConfig from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
