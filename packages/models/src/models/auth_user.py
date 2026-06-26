from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr

class AuthUser(BaseModel):
    id: Optional[str] = Field(None, json_schema_extra={"example":"123e4567-e89b-12d3-a456-426614174000"}, description="Primary user id (UUID)")
    tenant_id: Optional[str] = Field(None, json_schema_extra={"example":"tenant_001"}, description="Tenant/org identifier for multi-tenant apps")
    external_id: Optional[str] = Field(None, json_schema_extra={"example":"00u1abcdEFGH2ijkL3p4"}, description="IdP subject/user id (Okta/Cognito/etc)")
    email: Optional[str] = Field(None, json_schema_extra={"example":"john@company.com"})
    email_verified: Optional[bool] = Field(False, description="Whether the email address has been verified", json_schema_extra={"example":True})
    fullname: Optional[str] = Field(None, json_schema_extra={"example":"John Doe"})
    given_name: Optional[str] = Field(None, json_schema_extra={"example":"John"})
    family_name: Optional[str] = Field(None, json_schema_extra={"example":"Doe"})
    phone: Optional[str] = Field(None, json_schema_extra={"example":"+1-503-555-1212"})
    avatar_url: Optional[str] = Field(None, json_schema_extra={"example":"https://cdn.example.com/avatar/john.png"})
    roles: Optional[list[str]] = Field(None, description="Role names used for authorization", json_schema_extra={"example":["Admin","User"]})
    permissions: Optional[list[str]] = Field(None, description="Optional fine-grained permissions", json_schema_extra={"example":["reports.read","reports.write"]})
    status: Literal["active","invited","disabled","locked"] = Field("active", description="Account lifecycle status", json_schema_extra={"example":"active"})
    auth_provider: Optional[Literal["local","oauth","unknown"]] = Field("local", description="Where the user authenticates", json_schema_extra={"example":"okta"})
    password_hash: Optional[str] = Field(None, json_schema_extra={"example":"$2b$12$abcdefghijklmnopqrstuv"})
    password_updated_at: Optional[int] = Field(None, description="Epoch ms when password was last changed", json_schema_extra={"example":1683123456789})
    is_mfa_enabled: Optional[bool] = Field(False, description="Enable multi-factor auth", json_schema_extra={"example":True})
    totp_secret: Optional[str] = Field(None, description="TOTP secret (should be encrypted at rest)", json_schema_extra={"example":"BASE32SECRET"})
    login_count: Optional[int] = Field(0, json_schema_extra={"example":5})
    last_login: Optional[int] = Field(None, json_schema_extra={"example":1683123456789})
    last_unsuccessful_login: Optional[int] = Field(None, json_schema_extra={"example":1683123456789})
    failed_login_count: Optional[int] = Field(0, description="Consecutive failed login attempts", json_schema_extra={"example":2})
    locked_until: Optional[int] = Field(None, description="Epoch ms until account lock expires (if locked)", json_schema_extra={"example":1683127456789})
    accepted_tos_date: Optional[int] = Field(None, description="Epoch ms when ToS was accepted", json_schema_extra={"example":1683123456789})
    created: Optional[int] = Field(None, json_schema_extra={"example":1683123456789})
    modified: Optional[int] = Field(None, json_schema_extra={"example":1683123456789})

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load AuthUser from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load AuthUser from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load AuthUser from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load AuthUser from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
