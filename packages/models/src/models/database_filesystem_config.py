from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr

class DatabaseFilesystemConfig(BaseModel):
    id: Optional[str] = Field("default", json_schema_extra={"example":"default"})
    name: Optional[str] = Field("default", description="The default name of this client", json_schema_extra={"example":"database"})
    database_dir: Optional[str] = Field(None, description="Database Directory", json_schema_extra={"example":"data/filesystem_db"})

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load DatabaseFilesystemConfig from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load DatabaseFilesystemConfig from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load DatabaseFilesystemConfig from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load DatabaseFilesystemConfig from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
