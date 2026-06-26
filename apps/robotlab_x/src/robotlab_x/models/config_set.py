from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr

class ConfigSet(BaseModel):
    id: Optional[str] = Field(None, description="Config set name (primary key)", json_schema_extra={"example":"default"})
    name: Optional[str] = Field(None, description="Config set name")
    active: Optional[bool] = Field(None, description="True if this is the LIVE booted set (what the process reads and writes)")
    pending: Optional[bool] = Field(None, description="True if this set is marked to boot next (differs from active until a restart)")
    proxy_count: Optional[int] = Field(None, description="Number of per-proxy yml files in the set")
    has_runtime_yml: Optional[bool] = Field(None, description="Whether the set has a runtime.yml")
    root_dir: Optional[str] = Field(None, description="Absolute path of the parent config_sets directory")
    path: Optional[str] = Field(None, description="Absolute path of this set's directory")
    start_order: Optional[list] = Field(None, description="Ordered proxy ids the set starts on boot (detail view only)", json_schema_extra={"type":"array","items":{"type":"string"}})
    proxies: Optional[list] = Field(None, description="Per-proxy file info in start_order (detail view only)", json_schema_extra={"type":"array","items":{"type":"object","additionalProperties":True}})
    candidates: Optional[list] = Field(None, description="Per-proxy file info not in start_order (detail view only)", json_schema_extra={"type":"array","items":{"type":"object","additionalProperties":True}})

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load ConfigSet from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load ConfigSet from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load ConfigSet from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load ConfigSet from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
