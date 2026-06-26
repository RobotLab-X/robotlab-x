from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr

class AuthOauthProviderConfig(BaseModel):
    id: Optional[str] = Field("default", json_schema_extra={"example":"default"})
    provider_id: Optional[str] = Field("default", description="The default provider id of this oauth2 client", json_schema_extra={"example":"oauth2_provider"})
    name: Optional[str] = Field("default", description="The default name of this oauth2 client", json_schema_extra={"example":"oauth2_client"})
    authorize_url: Optional[str] = Field(None, description="OAuth2 Authorization URL", json_schema_extra={"example":"https://provider.com/oauth2/authorize"})
    token_url: Optional[str] = Field(None, description="OAuth2 Token URL", json_schema_extra={"example":"https://provider.com/oauth2/token"})
    issuer: Optional[str] = Field(None, description="OAuth2 Issuer", json_schema_extra={"example":"https://provider.com/"})
    client_id: Optional[str] = Field(None, description="OAuth2 Client ID", json_schema_extra={"example":"your-client-id"})
    redirect_uri: Optional[str] = Field(None, description="OAuth2 Redirect URI", json_schema_extra={"example":"https://yourapp.com/oauth2/callback"})
    scopes: Optional[list[str]] = Field([], description="OAuth2 Scopes", json_schema_extra={"example":["openid","profile", "email"]})
    state: Optional[str] = Field(None, description="State parameter to prevent CSRF attacks", json_schema_extra={"example":"xyzABC123"})
    access_type: Optional[str] = Field(None, description="Access type", json_schema_extra={"example":"offline"})
    prompt: Optional[str] = Field(None, description="Prompt type", json_schema_extra={"example":"consent"})
    include_granted_scopes: Optional[bool] = Field(False, description="Include granted scopes", json_schema_extra={"example":True})
    pkce_required: Optional[bool] = Field(False, description="Is PKCE required", json_schema_extra={"example":True})
    response_type: Optional[str] = Field("code", description="OAuth2 Response Type", json_schema_extra={"example":"code"})
    response_mode: Optional[str] = Field("query", description="OAuth2 Response Mode", json_schema_extra={"example":"query"})
    userinfo_url: Optional[str] = Field(None, description="OAuth2 UserInfo endpoint", json_schema_extra={"example":"https://provider.com/oauth2/userinfo"})
    logout_url: Optional[str] = Field(None, description="OAuth2 logout endpoint", json_schema_extra={"example":"https://provider.com/oauth2/logout"})
    extra_auth_params: Optional[dict[str, str]] = Field({}, description="Extra auth params", json_schema_extra={"example":{"access_type":"offline"}})
    client_secret: Optional[str] = Field(None, description="OAuth2 Client Secret", json_schema_extra={"example":"your-client-secret"})

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load AuthOauthProviderConfig from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load AuthOauthProviderConfig from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load AuthOauthProviderConfig from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load AuthOauthProviderConfig from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
