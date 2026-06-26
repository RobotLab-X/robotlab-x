from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr

class DatabaseMongodbConfig(BaseModel):
    id: Optional[str] = Field("default", json_schema_extra={"example":"default"})
    name: Optional[str] = Field("default", description="The default name of this client", json_schema_extra={"example":"database"})
    mongodb_replica_uri: Optional[str] = Field(None, description="MongoDB Replica URI", json_schema_extra={"example":"mongodb://localhost:27017"})
    mongodb_database_name: Optional[str] = Field(None, description="MongoDB Database Name", json_schema_extra={"example":"mydatabase"})
    mongodb_max_pool_size: Optional[int] = Field(10, description="MongoDB Max Pool Size", json_schema_extra={"example":10})
    mongodb_min_pool_size: Optional[int] = Field(1, description="MongoDB Min Pool Size", json_schema_extra={"example":1})

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load DatabaseMongodbConfig from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load DatabaseMongodbConfig from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load DatabaseMongodbConfig from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load DatabaseMongodbConfig from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
