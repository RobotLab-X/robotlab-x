from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr

class Link(BaseModel):
    id: Optional[str] = Field(None, description="Stable link key - source_proxy/source_topic->target_proxy/target_sink")
    source_proxy_id: Optional[str] = Field(None, description="Proxy id the data flows FROM (the publisher / the consumer holding the binding)")
    source_topic: Optional[str] = Field(None, description="Bus topic carrying the data, when the link is a topic subscription")
    target_proxy_id: Optional[str] = Field(None, description="Proxy id the data flows TO (the subscriber / the referenced controller)")
    target_sink: Optional[str] = Field(None, description="Channel id, pin, or capability slot on the consumer that receives the data")
    kind: Optional[str] = Field(None, description="Link kind - input (topic subscription) or capability (controller binding)", json_schema_extra={"example":"input"})
    origin: Optional[str] = Field(None, description="declared (from config) | observed (live bus) | both", json_schema_extra={"example":"both"})

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load Link from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load Link from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load Link from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load Link from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
