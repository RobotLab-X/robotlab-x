from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr

class Topic(BaseModel):
    id: Optional[str] = Field(None, description="Primary key - set to workspace_id/name on create", json_schema_extra={"example":"vision-pipeline//camera/rgb"})
    workspace_id: str = Field(..., description="Parent workspace name", json_schema_extra={"example":"vision-pipeline"})
    name: str = Field(..., description="Topic channel name - use ROS2-style slash-prefixed paths", json_schema_extra={"example":"/camera/rgb/image_raw"})
    message_type: Optional[str] = Field(None, description="Message type identifier - e.g. Image, PointCloud, or custom", json_schema_extra={"example":"Image"})
    description: Optional[str] = Field(None, description="Human-readable description of what this topic carries")
    publisher_proxy_id: Optional[str] = Field(None, description="Service proxy that publishes to this topic - None means external or anonymous publisher", json_schema_extra={"example":"cam"})
    retained: Optional[bool] = Field(False, description="Whether to keep the last message for late subscribers")
    qos: Optional[dict] = Field(None, description="Quality of service settings - reliability, history, depth", json_schema_extra={"type":"object","properties":{"reliability":{"type":"string","enum":["reliable","best_effort"]},"history":{"type":"string","enum":["keep_last","keep_all"]},"depth":{"type":"integer"}},"example":{"reliability":"reliable","history":"keep_last","depth":10}})

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load Topic from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load Topic from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load Topic from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load Topic from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
