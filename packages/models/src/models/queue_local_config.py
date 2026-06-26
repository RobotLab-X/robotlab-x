from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr

class QueueLocalConfig(BaseModel):
    id: Optional[str] = Field("default", json_schema_extra={"example":"default"})
    name: Optional[str] = Field("default", description="The default name of this client", json_schema_extra={"example":"queue"})
    max_workers: Optional[int] = Field(5, description="Maximum number of worker threads", json_schema_extra={"example":5})
    max_queue_size: Optional[int] = Field(100, description="Maximum size of the queue", json_schema_extra={"example":100})

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load QueueLocalConfig from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load QueueLocalConfig from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load QueueLocalConfig from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load QueueLocalConfig from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
