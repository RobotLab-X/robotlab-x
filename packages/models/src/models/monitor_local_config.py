from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr

class MonitorLocalConfig(BaseModel):
    id: Optional[str] = Field("default", json_schema_extra={"example":"default"})
    name: Optional[str] = Field("default", description="The default name of this monitor config", json_schema_extra={"example":"monitor_config"})
    check_disk_space_used_threshold_percent: Optional[int] = Field(80, description="Threshold percentage for disk space alerts", json_schema_extra={"example":90})
    check_memory_used_threshold_percent: Optional[int] = Field(90, description="Threshold percentage for memory available alerts", json_schema_extra={"example":90})
    check_load_average_threshold_percent: Optional[float] = Field(95, description="Threshold for load average usage percent alerts", json_schema_extra={"example":95})
    interval_seconds: Optional[int] = Field(60, description="Interval in seconds between checks", json_schema_extra={"example":60})
    message_id: Optional[str] = Field("default", description="Message Client ID to use for notifications", json_schema_extra={"example":"default"})
    alert_on_threshold_crossed: Optional[bool] = Field(True, description="Send alert only when thresholds are crossed", json_schema_extra={"example":True})

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load MonitorLocalConfig from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load MonitorLocalConfig from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load MonitorLocalConfig from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load MonitorLocalConfig from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
