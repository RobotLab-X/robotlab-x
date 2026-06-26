from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr
from models.config_base import ConfigBase

# .env file for configuration
class Config(ConfigBase):
    id: Optional[str] = Field("default", description="Config record id (use 'default' for the singleton app config)", json_schema_extra={"example":"default"})
    database_type: Literal["postgres", "lowdb", "filesystem", "none"] = Field("lowdb", description="Database backend", json_schema_extra={"example":"lowdb"})
    data_dir: Optional[str] = Field("data", description="Per-process working directory. Houses databases/ (TinyDB JSON files), runtime_id (federation handle), admin_password.txt, and any other instance-local state. Set per-runtime via ROBOTLAB_X_DATA_DIR; sibling runtimes on the same box use distinct values to keep their state isolated.", json_schema_extra={"example":"data"})
    repo_dir: Optional[str] = Field("repo", description="The WRITABLE service repo root. Loads (downloaded archives) extract here and installs (per-type .venv) build here. Dev uses 'repo' (the monorepo checkout); a frozen bundle uses var/repo (seeded by packaging/entry.py). CWD-relative when not absolute.", json_schema_extra={"example":"repo"})
    repo_paths: Optional[list] = Field(None, description="Additional READ-ONLY local repo roots scanned for service types, in order, on top of the writable repo_dir. Lets a runtime reference a separate public robotlab_x-services checkout and/or a private services directory without copying them in. Each entry is a filesystem path to a directory holding <type>/<version>/ dirs. Resolution precedence is writable repo_dir first, then these in listed order, first match per type@version wins. Empty/None in normal dev — the single repo_dir is enough.", json_schema_extra={"type":"array","items":{"type":"string"},"example":["/home/me/robotlab_x-services","/home/me/.rlx/private"]})
    registries: Optional[list] = Field(None, description="Ordered list of remote catalog.yml URLs searched for ABSENT types (those not present in any local repo root). The first registry that has a requested type@version serves it. Supports file:// (local mirror) and http(s)://. When empty/None, falls back to the single registry_url. Lets a runtime pull from the public registry plus a private mirror.", json_schema_extra={"type":"array","items":{"type":"string"},"example":["https://repo.robotlab-x.com/catalog.yml","file:///tmp/repo/catalog.yml"]})
    jwt_access_token_ttl_minutes: Optional[int] = Field(1440, description="Access-token JWT lifetime in minutes. The UI refreshes the token via /v1/refresh-token when it expires; this knob controls how often that happens. Default 60.", json_schema_extra={"example":1440})
    runtime_id: Optional[str] = Field(None, description="Override the runtime's federation id (the adjective-noun handle peers address us by). Set via ROBOTLAB_X_RUNTIME_ID in .env. When None, identity.py auto-generates + persists one to data/runtime_id.", json_schema_extra={"example":"funny-droid"})
    registry_url: Optional[str] = Field("file:///tmp/repo/catalog.yml", description="URL of the remote service registry's catalog.yml. The Registry API endpoints (/v1/registry/*) read from here; tools/publish_services.py --target local writes a catalog.yml that this default resolves against. Supports file:// (local mirror) and http(s):// (Phase 5 remote targets).", json_schema_extra={"example":"file:///tmp/repo/catalog.yml"})
    auth_bootstrap: Literal["admin_seed", "first_user_claim"] = Field("first_user_claim", description="How the user table is initialised on a fresh runtime. 'admin_seed' auto-creates admin@cloudseeder.ai with a generated password. 'first_user_claim' skips that seed and lets the operator establish the first account via POST /v1/auth/claim-first-user — paired with event_handlers.on_first_user for per-app role assignment. Generator-injected by app.auth.bootstrap.", json_schema_extra={"example":"first_user_claim"})

    model_config = ConfigDict(
        env_prefix="ROBOTLAB_X_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="forbid",
    )

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load Config from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load Config from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load Config from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load Config from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
