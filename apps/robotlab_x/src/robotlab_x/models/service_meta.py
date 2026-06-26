from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr

class ServiceMeta(BaseModel):
    name: str = Field(..., description="Service name", json_schema_extra={"example":"camera"})
    title: Optional[str] = Field(None, description="Human-readable display title for the service type, shown in the catalog and palette when set; falls back to name when empty (current behaviour). Unlike name (the dir key, [A-Za-z0-9._-]) this is free-form — spaces, punctuation, casing allowed.", json_schema_extra={"example":"USB Camera"})
    version: str = Field("1.0.0", description="Semantic version", json_schema_extra={"example":"1.0.0"})
    description: Optional[str] = Field(None, description="Human-readable description of what this service does")
    installed: Optional[bool] = Field(None, description="DERIVED MIRROR of install_phase=='installed', kept for one release for back-compat. New code reads install_phase. Whether the service is currently installed (venv built for pip types; always true for builtins) and ready to Start.")
    install_phase: Optional[str] = Field(None, description="Lifecycle stage of this service TYPE on this runtime - one of loaded, installing, installed, failed. 'loaded' means source on disk and registered in the catalog but not yet runnable (no venv for pip types); 'installing' is the LOADED to INSTALLED transition in progress; 'installed' is ready to Start; 'failed' means the last load or install transition errored (see load_error and install_error). ABSENT (no row at all) is the implicit fourth state, a type known only to a remote registry. Builtins collapse loaded and installed into one.", json_schema_extra={"example":"installed"})
    load_error: Optional[str] = Field(None, description="If the ABSENT→LOADED transition failed (network, sha256 mismatch, extract error), the detail. Distinct from install_error so the UI can tell 'never got the bits' from 'got the bits but the install failed'.")
    install_error: Optional[str] = Field(None, description="If the LOADED→INSTALLED transition failed (venv build / pip), the detail.")
    installation_exception: Optional[str] = Field(None, description="DEPRECATED — superseded by load_error / install_error. Retained for one release; new code should not write it.")
    repo_root: Optional[str] = Field(None, description="Absolute path of the local repo root this type's source resolved from. With multiple repo roots (config.repo_paths + the writable repo_dir), records which one holds the source so install/uninstall act on the right directory. None for legacy single-root rows.")
    bundled: Optional[bool] = Field(None, description="Whether this service's source ships inside the robotlab_x binary bundle (true) vs is pulled from the remote registry (false). Read from each package.yml; independent of whether the service is also published to a registry. UI uses this to gate the 'Remove' action — bundled types can't be fully removed because re-extracting the bundle would restore them.", json_schema_extra={"example":True})
    status: Optional[str] = Field("development", description="Lifecycle status - development, alpha, beta, released, deprecated", json_schema_extra={"example":"released"})
    os: Optional[list] = Field(None, description="Supported operating systems - linux, windows, macos, any", json_schema_extra={"type":"array","items":{"type":"string"},"example":["linux","macos"]})
    is_dockerized: Optional[bool] = Field(None, description="Whether the service is containerized for easier deployment")
    is_cloud: Optional[bool] = Field(None, description="Whether the service can run in the cloud or requires local hardware access")
    arch: Optional[list] = Field(None, description="Supported architectures - x86, arm, arm64, any", json_schema_extra={"type":"array","items":{"type":"string"},"example":["x86","arm64"]})
    language: Optional[str] = Field(None, description="Implementation language - python, javascript, typescript, rust", json_schema_extra={"example":"python"})
    dependency_manager: Optional[str] = Field(None, description="Package manager - npm, uv, pip, cargo", json_schema_extra={"example":"uv"})
    package_spec: Optional[str] = Field(None, description="Pip-installable package spec for Phase 6 pip installer. None for builtin services (echo, clock) that have no install step.", json_schema_extra={"example":"-e ./repo/echo_http"})
    entry_argv: Optional[list] = Field(None, description="argv for process_manager.start() — first element is the executable (typically `python`), supports ${PORT} substitution from the allocated port", json_schema_extra={"type":"array","items":{"type":"string"},"example":["python","-m","echo_http","--port","${PORT}"]})
    entry_in_process: Optional[dict] = Field(None, description="In-process service entry point. Mutually exclusive with entry_argv. The framework's InProcessAdapter loads <repo>/<name>/<version>/<module>.py and instantiates <class>.", json_schema_extra={"type":"object","properties":{"module":{"type":"string"},"class":{"type":"string"}},"example":{"module":"clock","class":"ClockService"}})
    rating: Optional[float] = Field(None, description="Average user rating 0.0 to 5.0", json_schema_extra={"example":4.5})
    tags: Optional[list] = Field(None, description="Descriptive tags for discoverability", json_schema_extra={"type":"array","items":{"type":"string"},"example":["vision","camera"]})
    implements: Optional[list] = Field(None, description="Capability interfaces this service implements. Other services discover compatible peers by filtering for the interface name.", json_schema_extra={"type":"array","items":{"type":"string"},"example":["servo_controller"]})
    requires: Optional[list] = Field(None, description="Capability interfaces this service requires to attach to. UI uses this to filter the attach-controller dropdown.", json_schema_extra={"type":"array","items":{"type":"string"},"example":["servo_controller"]})
    author: Optional[str] = Field(None, description="Service author or organization", json_schema_extra={"example":"CloudSeeder"})
    homepage: Optional[str] = Field(None, description="URL to documentation or repository")
    license: Optional[str] = Field(None, description="License notice/agreement the operator must accept once before the type installs. None means no license gate. Read from package.yml; shown by the install wizard.")
    wizard_steps: Optional[list] = Field(None, description="Install-time wizard step definitions shown before installation begins", json_schema_extra={"type":"array","items":{"type":"object","additionalProperties":True,"properties":{"id":{"type":"string"},"title":{"type":"string"},"description":{"type":"string"},"fields":{"type":"array","items":{"type":"object","additionalProperties":True}}}}})
    wizard_schema: Optional[dict] = Field(None, description="JSON Schema Draft-7 for install-time wizard values — validated by ajv in doInstall()", json_schema_extra={"type":"object","additionalProperties":True})
    install_steps: Optional[list] = Field(None, description="Automated installation step definitions executed by the backend", json_schema_extra={"type":"array","items":{"type":"object","additionalProperties":True,"properties":{"id":{"type":"string"},"action":{"type":"string"},"label":{"type":"string"},"description":{"type":"string"}}}})
    config_steps: Optional[list] = Field(None, description="Per-instance configuration wizard steps shown on first Start", json_schema_extra={"type":"array","items":{"type":"object","additionalProperties":True,"properties":{"id":{"type":"string"},"title":{"type":"string"},"description":{"type":"string"},"fields":{"type":"array","items":{"type":"object","additionalProperties":True}}}}})
    config_schema: Optional[dict] = Field(None, description="JSON Schema Draft-7 for per-instance config values — validated by ajv in doStart()", json_schema_extra={"type":"object","additionalProperties":True})
    ui_schema: Optional[dict] = Field(None, description="RJSF ui:schema for per-instance config form rendering hints (e.g. password widgets, field order)", json_schema_extra={"type":"object","additionalProperties":True})
    ui: Optional[dict] = Field(None, description="Modular service-UI bundle descriptor (Option B — see docs/TODO_SERVICE_UI_BUNDLES.md). When present, the service ships a pre-built frontend ESM the host dynamically imports instead of a built-in serviceViews component. Shape — entry='ui/dist/ui.js', css?='ui/dist/ui.css', sdk='^1.0'. None = no bundled UI.", json_schema_extra={"type":"object","additionalProperties":True})

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load ServiceMeta from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load ServiceMeta from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load ServiceMeta from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load ServiceMeta from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
