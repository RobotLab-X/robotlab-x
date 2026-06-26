# managed
from pydantic import BaseModel, Field, ConfigDict, model_validator
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr


class AuthRegistration(BaseModel):
    id: Optional[str] = Field(None, json_schema_extra={"example":"123e4567-e89b-12d3-a456-426614174000"}, description="Verification token (UUID)")
    user_id: Optional[str] = Field(None, json_schema_extra={"example":"john@company.com"}, description="Future user ID (typically email)")
    email: Optional[str] = Field(None, json_schema_extra={"example":"john@company.com"}, description="User email address")
    fullname: Optional[str] = Field(None, json_schema_extra={"example":"John Doe"}, description="User full name")
    password_hash: Optional[str] = Field(None, json_schema_extra={"example":"$2b$12$abcdefg..."}, description="Hashed password")
    password: Optional[str] = Field(None, json_schema_extra={"example":"SecurePass123!"}, description="Temporary password field (not stored)")
    state: Optional[Literal["registered", "verified"]] = Field("registered", description="Registration state - server will set to 'registered' if not provided", json_schema_extra={"example":"registered"})
    verification_token: Optional[str] = Field(None, json_schema_extra={"example":"123e4567-e89b-12d3-a456-426614174000"}, description="Verification token")
    created: Optional[int] = Field(None, json_schema_extra={"example":1683123456789}, description="Created timestamp in milliseconds")
    client_base_url: Optional[str] = Field(None, description="Base URL for the client", json_schema_extra={"example":"http://localhost:3020"})

    @model_validator(mode='before')
    @classmethod
    def normalize_state(cls, data: Any) -> Any:
        """
        Convert invalid state values to 'registered' before field validation.
        
        This validator ensures backward compatibility with frontends that may send
        invalid state values (e.g., 'new', 'pending', etc.). Any value not in the
        allowed set ['registered', 'verified'] will be automatically converted to
        'registered'.
        
        This runs BEFORE Pydantic's field-level validation, allowing us to transform
        invalid input into valid values gracefully.
        """
        if isinstance(data, dict) and 'state' in data:
            state_value = data['state']
            if state_value not in ['registered', 'verified']:
                data['state'] = 'registered'
        return data

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load AuthRegistration from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load AuthRegistration from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load AuthRegistration from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load AuthRegistration from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
