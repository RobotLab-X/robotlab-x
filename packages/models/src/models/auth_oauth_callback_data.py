from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr

class AuthOauthCallbackData(BaseModel):
    id: Optional[str] = Field(None, json_schema_extra={"example":"123e4567-e89b-12d3-a456-426614174000"})
    access_token: Optional[str] = Field(None, description="Access token from the OAuth provider", json_schema_extra={"example":"ya29.a0AfH6SM..."})
    access_type: Optional[str] = Field(None, description="Type of the access", json_schema_extra={"example":"offline"})
    additional_info: Optional[dict[str, Any]] = Field(None, description="Any additional information related to the OAuth token")
    app_client_id: Optional[str] = Field(None, description="Client ID of the application registered with the OAuth provider", json_schema_extra={"example":"your-google-client-id"})
    app_client_secret: Optional[str] = Field(None, description="Client secret of the application registered with the OAuth provider", json_schema_extra={"example":"your-google-client-secret"})
    app_name: Optional[str] = Field(None, description="Name of the application using the OAuth token", json_schema_extra={"example":"Senior Pathways"})
    auth_url: Optional[str] = Field(None, description="Authorization URL of the OAuth provider", json_schema_extra={"example":"https://accounts.google.com/o/oauth2/auth"})
    code: Optional[str] = Field(None, description="Authorization code received from the OAuth provider", json_schema_extra={"example":"4/0Ab12345cdefGHIJKLMN"})
    color: Optional[str] = Field(None, description="Hex color code associated with the OAuth provider", json_schema_extra={"example":"#4285F4"})
    created_at: Optional[int] = Field(None, description="Epoch time when the token was created", json_schema_extra={"example":1683123456})
    email: Optional[str] = Field(None, description="Email associated with the OAuth account", json_schema_extra={"example":"supertick@gmail.com"})
    error: Optional[str] = Field(None, description="Error message if any", json_schema_extra={"example":"Invalid token"})
    error_description: Optional[str] = Field(None, description="Detailed error description if any", json_schema_extra={"example":"The access token has expired"})
    expires_in: Optional[int] = Field(None, description="Time in seconds until the token expires", json_schema_extra={"example":3599})
    id_token: Optional[str] = Field(None, description="ID token from the OAuth provider", json_schema_extra={"example":"eyJhbGciOiJSUzI1NiIsImtpZCI6Ij..."})
    id_token_payload: Optional[dict[str, Any]] = Field(None, description="Decoded payload of the ID token")
    last_used: Optional[int] = Field(None, description="Epoch time when the token was last used", json_schema_extra={"example":1683126789})
    profile: Optional[dict[str, Any]] = Field(None, description="Profile information from the OAuth provider")
    prompt: Optional[str] = Field(None, description="Prompt type used in the OAuth flow", json_schema_extra={"example":"consent"})
    provider: Optional[str] = Field(None, description="OAuth provider name", json_schema_extra={"example":"Google"})
    raw_response: Optional[dict[str, Any]] = Field(None, description="Raw response from the OAuth provider")
    redirect_uri: Optional[str] = Field(None, description="Redirect URI used in the OAuth flow", json_schema_extra={"example":"http://localhost:8010/oauth/google/callback"})
    refresh_expires_in: Optional[int] = Field(None, description="Time in seconds until the refresh token expires", json_schema_extra={"example":7776000})
    refresh_token: Optional[str] = Field(None, description="Refresh token from the OAuth provider", json_schema_extra={"example":"1//0g..."})
    scope: Optional[str] = Field(None, description="Scopes granted by the OAuth provider", json_schema_extra={"example":"https://www.googleapis.com/auth/calendar"})
    scopes: Optional[List[str]] = Field(None, description="List of scopes granted by the OAuth provider", json_schema_extra={"example":["https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/userinfo.email"]})
    state: Optional[str] = Field(None, description="State parameter to prevent CSRF attacks", json_schema_extra={"example":"xyzABC123"})
    status: Literal["active", "inactive", "revoked"] = Field("active", description="Status of the OAuth token", json_schema_extra={"example":"active"})
    token_expires_at: Optional[int] = Field(None, description="Epoch time when the token expires", json_schema_extra={"example":1683127056})
    token_issued_at: Optional[int] = Field(None, description="Epoch time when the token was issued", json_schema_extra={"example":1683123456})
    token_type: Optional[str] = Field(None, description="Type of the token", json_schema_extra={"example":"Bearer"})
    type: Optional[str] = Field("other", description="Type of the OAuth provider", json_schema_extra={"example":"google"})
    user_id: Optional[str] = Field(None, description="User ID associated with the OAuth account", json_schema_extra={"example":"greg.perry@cloudseeder.ai"})
    userinfo: Optional[dict[str, Any]] = Field(None, description="User information from the OAuth provider")

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load AuthOauthCallbackData from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load AuthOauthCallbackData from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load AuthOauthCallbackData from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load AuthOauthCallbackData from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
