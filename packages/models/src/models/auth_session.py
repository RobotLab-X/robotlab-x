from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr

class AuthSession(BaseModel):
    id: Optional[str] = Field(None, json_schema_extra={"example":"sess_123e4567e89b12d3"})
    user_id: Optional[str] = Field(None, json_schema_extra={"example":"123e4567-e89b-12d3-a456-426614174000"})
    tenant_id: Optional[str] = Field(None, json_schema_extra={"example":"tenant_001"})
    refresh_token_hash: Optional[str] = Field(None, description="Hash of refresh token (never store raw refresh token)", json_schema_extra={"example":"sha256:abcd..."})
    status: Literal["active","revoked","expired"] = Field("active", json_schema_extra={"example":"active"})
    created: Optional[int] = Field(None, json_schema_extra={"example":1683123456789})
    expires_at: Optional[int] = Field(None, json_schema_extra={"example":1685725456789})
    revoked_at: Optional[int] = Field(None, json_schema_extra={"example":1684000000000})
    last_used_at: Optional[int] = Field(None, json_schema_extra={"example":1683124456789})
    user_agent: Optional[str] = Field(None, json_schema_extra={"example":"Mozilla/5.0"})
    ip_address: Optional[str] = Field(None, json_schema_extra={"example":"203.0.113.42"})

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load AuthSession from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load AuthSession from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load AuthSession from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load AuthSession from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
