from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr

class MonitorData(BaseModel):
    id: Optional[str] = Field("default", json_schema_extra={"example":"default"})
    name: Optional[str] = Field("default", description="The default name of this monitor", json_schema_extra={"example":"monitor"})
    started: Optional[int] = Field(None, json_schema_extra={"example":1683123456789}, description="Timestamp when the monitor was started")
    drive_space_total_gb: Optional[int] = Field(None, json_schema_extra={"example":500}, description="Total drive space in GB")
    drive_free_space_gb: Optional[int] = Field(None, json_schema_extra={"example":200}, description="Free drive space in GB")
    memory_total_gb: Optional[int] = Field(None, json_schema_extra={"example":16}, description="Total memory in GB")
    memory_available_gb: Optional[int] = Field(None, json_schema_extra={"example":8}, description="Available memory in GB")
    load_average: Optional[float] = Field(None, json_schema_extra={"example":0.5}, description="Load average over the last 1 minute")
    alert: Optional[str] = Field(None, json_schema_extra={"example":"Disk space low"}, description="Alert message if any thresholds are exceeded")

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load MonitorData from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load MonitorData from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load MonitorData from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load MonitorData from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
