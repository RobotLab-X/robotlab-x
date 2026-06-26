from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr

class Peer(BaseModel):
    id: Optional[str] = Field(None, description="Peer key — the remote_id once known, else the connect URL (primary key)")
    key: Optional[str] = Field(None, description="Peer key (same as id)")
    url: Optional[str] = Field(None, description="WebSocket URL of the remote runtime", json_schema_extra={"example":"ws://10.0.0.5:8998"})
    remote_id: Optional[str] = Field(None, description="The peer's runtime id once it identifies; null while still connecting")
    state: Optional[str] = Field(None, description="Connection state - identifying, connected, disconnected", json_schema_extra={"example":"connected"})
    upstream_subs: Optional[List[str]] = Field(None, description="Topic names this runtime subscribes to from the peer (bridged upstream)")
    collision: Optional[str] = Field(None, description="Set when the peer's runtime id collides with ours; human-readable detail")

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load Peer from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load Peer from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load Peer from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load Peer from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
