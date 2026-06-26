from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr

class ServiceRequest(BaseModel):
    id: Optional[str] = Field(None, description="UUID auto-generated on create", json_schema_extra={"example":"123e4567-e89b-12d3-a456-426614174000"})
    action: str = Field(..., description="Lifecycle action - install, start, stop, restart, uninstall, activate_workspace, deactivate_workspace", json_schema_extra={"example":"start"})
    service_meta_id: Optional[str] = Field(None, description="Target service catalog entry - required for install", json_schema_extra={"example":"opencv@4.8.0"})
    proxy_name: Optional[str] = Field(None, description="Desired proxy name - required for install to name the new proxy", json_schema_extra={"example":"pycv"})
    workspace_id: Optional[str] = Field(None, description="Target workspace name for activate_workspace and deactivate_workspace actions", json_schema_extra={"example":"vision-pipeline"})
    service_proxy_id: Optional[str] = Field(None, description="Target proxy name for start, stop, restart, uninstall actions", json_schema_extra={"example":"pycv"})
    config: Optional[dict] = Field(None, description="Initial or updated config params to apply alongside this request", json_schema_extra={"type":"object","additionalProperties":True,"example":{"port":7070}})
    status: Optional[str] = Field("pending", description="Request processing state - pending, running, completed, failed", json_schema_extra={"example":"completed"})
    result: Optional[str] = Field(None, description="Human-readable outcome message or error detail")
    created_at: Optional[str] = Field(None, description="ISO-8601 timestamp when the request was submitted")
    completed_at: Optional[str] = Field(None, description="ISO-8601 timestamp when the request finished")

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load ServiceRequest from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load ServiceRequest from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load ServiceRequest from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load ServiceRequest from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
