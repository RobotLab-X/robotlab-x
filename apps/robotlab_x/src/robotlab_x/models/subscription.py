from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr

class Subscription(BaseModel):
    id: Optional[str] = Field(None, description="UUID auto-generated on create")
    workspace_id: str = Field(..., description="Parent workspace name", json_schema_extra={"example":"vision-pipeline"})
    topic_id: str = Field(..., description="Topic this subscription listens to - workspace_id/name", json_schema_extra={"example":"vision-pipeline//camera/rgb"})
    subscriber_proxy_id: str = Field(..., description="Service proxy that receives messages from this topic", json_schema_extra={"example":"pycv"})
    method: Optional[str] = Field(None, description="Callback method name to invoke on the subscriber", json_schema_extra={"example":"process_frame"})
    filter: Optional[dict] = Field(None, description="Optional message filter criteria applied before delivery", json_schema_extra={"example":{"min_confidence":0.8}})

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load Subscription from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load Subscription from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load Subscription from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load Subscription from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
