from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr

class ServiceProxy(BaseModel):
    id: Optional[str] = Field(None, description="Primary key - set to proxy name on create", json_schema_extra={"example":"pycv"})
    name: str = Field(..., description="Unique human-readable name for this running instance", json_schema_extra={"example":"pycv"})
    service_meta_id: str = Field(..., description="Service catalog reference in name@version format", json_schema_extra={"example":"opencv@4.8.0"})
    status: Optional[str] = Field("stopped", description="Runtime state - stopped, installing, installed, starting, running, stopping, error", json_schema_extra={"example":"running"})
    configured: Optional[bool] = Field(None, description="Whether this proxy instance has been configured via the config wizard")
    pid: Optional[int] = Field(None, description="OS process ID when the service is running")
    host: Optional[str] = Field(None, description="Hostname or IP the service is bound to", json_schema_extra={"example":"127.0.0.1"})
    port: Optional[int] = Field(None, description="Port the service is listening on", json_schema_extra={"example":7070})
    created_at: Optional[str] = Field(None, description="ISO-8601 timestamp when the proxy record was created")
    started_at: Optional[str] = Field(None, description="ISO-8601 timestamp of the most recent successful start")
    stopped_at: Optional[str] = Field(None, description="ISO-8601 timestamp of the most recent stop or crash")
    error: Optional[str] = Field(None, description="Last error message if status is error")
    service_config: Optional[dict] = Field(None, description="Per-instance configuration params populated by the config wizard — mirrors service_config.params for this proxy", json_schema_extra={"type":"object","additionalProperties":True})

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load ServiceProxy from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load ServiceProxy from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load ServiceProxy from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load ServiceProxy from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
