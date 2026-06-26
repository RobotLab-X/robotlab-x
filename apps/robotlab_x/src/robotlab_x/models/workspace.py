from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr

class Workspace(BaseModel):
    id: Optional[str] = Field(None, description="Primary key - set to workspace name on create", json_schema_extra={"example":"vision-pipeline"})
    name: str = Field(..., description="Unique workspace name", json_schema_extra={"example":"vision-pipeline"})
    description: Optional[str] = Field(None, description="Human-readable description of this workspace")
    status: Optional[str] = Field("draft", description="Workspace state - draft, active, inactive", json_schema_extra={"example":"active"})
    kind: Optional[str] = Field("user", description="Workspace kind - 'user' (saved grouping) or 'runtime' (singleton live view of running services)", json_schema_extra={"example":"user","enum":["user","runtime"]})
    service_proxy_ids: Optional[list] = Field(None, description="Explicit list of service proxy names that belong to this workspace. For kind='runtime' this is computed from the registry (running services only) and not stored.", json_schema_extra={"type":"array","items":{"type":"string"},"example":["pycv","cam","ollama-main"]})
    node_positions: Optional[dict] = Field(None, description="Canvas position for each proxy node, keyed by proxy name", json_schema_extra={"type":"object","additionalProperties":{"type":"object","properties":{"x":{"type":"number"},"y":{"type":"number"}},"required":["x","y"]},"example":{"cam":{"x":80,"y":80}}})
    node_view_types: Optional[dict] = Field(None, description="Per-node visual variant on this canvas, keyed by proxy name. Values are 'view_min' (pill), 'view_name_and_type' (default, current shape), or 'view_full' (loads a service-type-specific UI keyed by service_meta_id).", json_schema_extra={"type":"object","additionalProperties":{"type":"string","enum":["view_min","view_name_and_type","view_full"]},"example":{"cam":"view_min"}})
    edges: Optional[list] = Field(None, description="Persisted React Flow edges (message routes) between service nodes on this canvas", json_schema_extra={"type":"array","items":{"type":"object","additionalProperties":True}})
    dashboard: Optional[dict] = Field(None, description="Dashboard widget configuration and layout — persisted as { widgets:WidgetConfig[], layout:Layout[] }", json_schema_extra={"type":"object","additionalProperties":True})
    viewport: Optional[dict] = Field(None, description="Canvas viewport state — pan offset (x, y) and zoom level", json_schema_extra={"type":"object","properties":{"x":{"type":"number"},"y":{"type":"number"},"zoom":{"type":"number","minimum":0.1,"maximum":2.0}},"required":["x","y","zoom"],"example":{"x":0,"y":0,"zoom":0.5}})
    activated_at: Optional[str] = Field(None, description="ISO-8601 timestamp of the last activate_workspace call - null when inactive. Used on boot to restore previously-running workspaces.")
    created_at: Optional[str] = Field(None, description="ISO-8601 timestamp when the workspace was created")
    updated_at: Optional[str] = Field(None, description="ISO-8601 timestamp when the workspace was last modified")

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load Workspace from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load Workspace from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load Workspace from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load Workspace from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
