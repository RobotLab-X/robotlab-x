from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr

class AuthTokenPair(BaseModel):
    access_token: Optional[str] = Field(None, description="JWT access token", json_schema_extra={"example":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."})
    refresh_token: Optional[str] = Field(None, description="Opaque refresh token (or JWT if you choose)", json_schema_extra={"example":"r1_2Qp9Y..."})
    token_type: Optional[Literal["Bearer"]] = Field("Bearer", json_schema_extra={"example":"Bearer"})
    expires_in: Optional[int] = Field(None, description="Seconds until access token expires", json_schema_extra={"example":3600})
    refresh_expires_in: Optional[int] = Field(None, description="Seconds until refresh token expires", json_schema_extra={"example":2592000})
    issued_at: Optional[int] = Field(None, description="Epoch ms when issued", json_schema_extra={"example":1683123456789})
    access_token_expires_at: Optional[int] = Field(None, description="Epoch ms when access token expires", json_schema_extra={"example":1683127056789})

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load AuthTokenPair from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load AuthTokenPair from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load AuthTokenPair from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load AuthTokenPair from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
