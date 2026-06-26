from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr

class DatabasePostgresConfig(BaseModel):
    id: Optional[str] = Field(None, json_schema_extra={"example":"123e4567-e89b-12d3-a456-426614174000"}, description="Unique identifier for the config instance")
    name: Optional[str] = Field("default", description="The default name of this client", json_schema_extra={"example":"database"})
    host: str = Field(..., description="Postgres server host")
    port: int = Field(5432, description="Postgres server port")
    user: str = Field(..., description="Username for Postgres")
    password: str = Field(..., description="Password for Postgres")
    database: str = Field(..., description="Database name")
    sslmode: Optional[str] = Field(None, description="SSL mode (optional)")
    ensure_table: Optional[bool] = Field(True, description="Ensure tables are created", json_schema_extra={"example":True})
    min_connections: int = Field(2, description="Minimum number of connections in the pool", json_schema_extra={"example":2})
    max_connections: int = Field(20, description="Maximum number of connections in the pool", json_schema_extra={"example":20})

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load DatabasePostgresConfig from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load DatabasePostgresConfig from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load DatabasePostgresConfig from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load DatabasePostgresConfig from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
