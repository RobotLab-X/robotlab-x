from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr

class DatabaseTinydbConfig(BaseModel):
    id: Optional[str] = Field("default", json_schema_extra={"example":"default"})
    name: Optional[str] = Field("default", description="The default name of this client", json_schema_extra={"example":"database"})
    data_dir: Optional[str] = Field("data/databases", description="Database Directory", json_schema_extra={"example":"data/databases"})

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load DatabaseTinydbConfig from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load DatabaseTinydbConfig from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load DatabaseTinydbConfig from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load DatabaseTinydbConfig from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
