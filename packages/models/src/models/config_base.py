# managed
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
import logging
import os
from pathlib import Path
from database.types import DateTimeStr

logger = logging.getLogger(__name__)


class ConfigBase(BaseSettings):
    id: Optional[str] = Field(None, json_schema_extra={"example":"123e4567-e89b-12d3-a456-426614174000"}, description="Unique identifier for the config instance")
    name: Optional[str] = Field("default", json_schema_extra={"example":"config"})
    description: Optional[str] = Field(None, json_schema_extra={"example":"This is the base config"})
    version: Optional[str] = Field("0.0.0", json_schema_extra={"example":"0.0.0"})
    created: Optional[int] = Field(None, json_schema_extra={"example":1683123456789}, description="Timestamp when the config was created")
    modified: Optional[int] = Field(None, json_schema_extra={"example":1683123456789}, description="Timestamp when the config was last modified")
    debug: Optional[bool] = Field(False, description="Enable debug mode", json_schema_extra={"example":False})
    log_level: Optional[str] = Field("INFO", description="Logging level", json_schema_extra={"example":"INFO"})
    log_format: Optional[str] = Field("text", description="Log output format - json for structured/production, text for human-readable/development", json_schema_extra={"example":"json"})
    log_uv_access_enabled: Optional[bool] = Field(True, description="True enables UV access logging", json_schema_extra={"example":False})
    port: Optional[int] = Field(8001, json_schema_extra={"example":8001})
    cors_origin: Optional[str] = Field("*", description="CORS allowed origin a specific URL to restrict access", json_schema_extra={"example":"http://localhost:5173"})
    num_pipelines: Optional[int] = Field(0, description="Number of pipelines to run", json_schema_extra={"example":4})
    auth_type: Literal["oauth", "local", "none"] = Field("local", description="Authentication type for the API. 'oauth' covers any OIDC/OAuth2 IdP (Okta, Cognito, Auth0, Google, etc.) — the vendor identity is set per-app via the AuthOauthProviderConfig returned by on_get_oauth_provider_config. 'local' uses LocalAuthProvider against the app database. 'none' disables authentication entirely.", json_schema_extra={"example":"oauth"})
    jwt_secret: Optional[str] = Field("", description="JWT signing secret — override via environment variable", json_schema_extra={"example":"change-me-in-production"})
    auth_session_ttl_seconds: Optional[int] = Field(86400, description="Refresh-token session lifetime in seconds. Hard upper bound on how long a refresh-token can be used before re-login is required. Default 24 hours.", json_schema_extra={"example":86400})
    auth_session_idle_timeout_seconds: Optional[int] = Field(1800, description="Idle timeout in seconds. Session expires at the next refresh-token call if previous activity was more than this long ago. Any value < 1 disables (only the absolute auth_session_ttl_seconds ceiling applies). Default 30 minutes.", json_schema_extra={"example":1800})
    jwt_access_token_ttl_minutes: Optional[int] = Field(1440, description="Access-token JWT lifetime in minutes. The UI refreshes the token via /v1/refresh-token when it expires; this knob controls how often that happens. Default 1440.", json_schema_extra={"example":1440})
    ssl_enabled: Optional[bool] = Field(False, description="Enable SSL", json_schema_extra={"example":True})
    resource_monitor_enabled: Optional[bool] = Field(True, description="Enable Resource Monitor", json_schema_extra={"example":True})
    app_server_enabled: Optional[bool] = Field(True, description="Enable app server", json_schema_extra={"example":True})

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="forbid",
    )

    def __init__(self, **data):
        """Initialize ConfigBase and log if .env file is not found."""
        env_file = self.model_config.get("env_file", ".env")
        env_file_path = Path(env_file) if env_file else None

        if env_file_path and not env_file_path.exists():
            logger.info(f"No {env_file} file found - using default configuration and environment variables")
        elif env_file_path and env_file_path.exists():
            logger.info(f"Loading configuration from {env_file}")

        super().__init__(**data)

    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load ConfigBase from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load ConfigBase from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load ConfigBase from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load ConfigBase from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
