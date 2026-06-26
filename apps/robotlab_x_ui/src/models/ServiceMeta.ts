// managed
// Service Meta interface for use across the project
export interface ServiceMeta {
  name: string;
  title?: string;
  version: string;
  description?: string;
  installed?: boolean;
  install_phase?: string;
  load_error?: string;
  install_error?: string;
  installation_exception?: string;
  repo_root?: string;
  bundled?: boolean;
  status?: string;
  os?: any;
  is_dockerized?: boolean;
  is_cloud?: boolean;
  arch?: any;
  language?: string;
  dependency_manager?: string;
  package_spec?: string;
  entry_argv?: any;
  entry_in_process?: any;
  rating?: number;
  tags?: any;
  implements?: any;
  requires?: any;
  author?: string;
  homepage?: string;
  license?: string;
  wizard_steps?: any;
  wizard_schema?: any;
  install_steps?: any;
  config_steps?: any;
  config_schema?: any;
  ui_schema?: any;
  ui?: any;
}

export function createEmptyServiceMeta(): ServiceMeta {
  return {
    name: "",
    title: undefined,
    version: "1.0.0",
    description: undefined,
    installed: undefined,
    install_phase: undefined,
    load_error: undefined,
    install_error: undefined,
    installation_exception: undefined,
    repo_root: undefined,
    bundled: undefined,
    status: "development",
    os: undefined,
    is_dockerized: undefined,
    is_cloud: undefined,
    arch: undefined,
    language: undefined,
    dependency_manager: undefined,
    package_spec: undefined,
    entry_argv: undefined,
    entry_in_process: undefined,
    rating: undefined,
    tags: undefined,
    implements: undefined,
    requires: undefined,
    author: undefined,
    homepage: undefined,
    license: undefined,
    wizard_steps: undefined,
    wizard_schema: undefined,
    install_steps: undefined,
    config_steps: undefined,
    config_schema: undefined,
    ui_schema: undefined,
    ui: undefined,
  };
}

// Helper function to validate ServiceMeta object
export function isServiceMeta(obj: any): obj is ServiceMeta {
  return obj && typeof obj === 'object';
}

// Helper function to clone ServiceMeta object
export function cloneServiceMeta(item: ServiceMeta): ServiceMeta {
  return {
    ...item,
  };
}

// JSON Schema for Fastify route validation and OpenAPI documentation
export const ServiceMetaSchema = {
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "Service name",
      "example": "camera"
    },
    "title": {
      "type": "string",
      "description": "Human-readable display title for the service type, shown in the catalog and palette when set; falls back to name when empty (current behaviour). Unlike name (the dir key, [A-Za-z0-9._-]) this is free-form \u2014 spaces, punctuation, casing allowed.",
      "example": "USB Camera"
    },
    "version": {
      "type": "string",
      "description": "Semantic version",
      "example": "1.0.0"
    },
    "description": {
      "type": "string",
      "description": "Human-readable description of what this service does"
    },
    "installed": {
      "type": "boolean",
      "description": "DERIVED MIRROR of install_phase=='installed', kept for one release for back-compat. New code reads install_phase. Whether the service is currently installed (venv built for pip types; always true for builtins) and ready to Start."
    },
    "install_phase": {
      "type": "string",
      "description": "Lifecycle stage of this service TYPE on this runtime - one of loaded, installing, installed, failed. 'loaded' means source on disk and registered in the catalog but not yet runnable (no venv for pip types); 'installing' is the LOADED to INSTALLED transition in progress; 'installed' is ready to Start; 'failed' means the last load or install transition errored (see load_error and install_error). ABSENT (no row at all) is the implicit fourth state, a type known only to a remote registry. Builtins collapse loaded and installed into one.",
      "example": "installed"
    },
    "load_error": {
      "type": "string",
      "description": "If the ABSENT\u2192LOADED transition failed (network, sha256 mismatch, extract error), the detail. Distinct from install_error so the UI can tell 'never got the bits' from 'got the bits but the install failed'."
    },
    "install_error": {
      "type": "string",
      "description": "If the LOADED\u2192INSTALLED transition failed (venv build / pip), the detail."
    },
    "installation_exception": {
      "type": "string",
      "description": "DEPRECATED \u2014 superseded by load_error / install_error. Retained for one release; new code should not write it."
    },
    "repo_root": {
      "type": "string",
      "description": "Absolute path of the local repo root this type's source resolved from. With multiple repo roots (config.repo_paths + the writable repo_dir), records which one holds the source so install/uninstall act on the right directory. None for legacy single-root rows."
    },
    "bundled": {
      "type": "boolean",
      "description": "Whether this service's source ships inside the robotlab_x binary bundle (true) vs is pulled from the remote registry (false). Read from each package.yml; independent of whether the service is also published to a registry. UI uses this to gate the 'Remove' action \u2014 bundled types can't be fully removed because re-extracting the bundle would restore them.",
      "example": true
    },
    "status": {
      "type": "string",
      "description": "Lifecycle status - development, alpha, beta, released, deprecated",
      "example": "released"
    },
    "os": {
      "description": "Supported operating systems - linux, windows, macos, any",
      "example": [
        "linux",
        "macos"
      ],
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "is_dockerized": {
      "type": "boolean",
      "description": "Whether the service is containerized for easier deployment"
    },
    "is_cloud": {
      "type": "boolean",
      "description": "Whether the service can run in the cloud or requires local hardware access"
    },
    "arch": {
      "description": "Supported architectures - x86, arm, arm64, any",
      "example": [
        "x86",
        "arm64"
      ],
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "language": {
      "type": "string",
      "description": "Implementation language - python, javascript, typescript, rust",
      "example": "python"
    },
    "dependency_manager": {
      "type": "string",
      "description": "Package manager - npm, uv, pip, cargo",
      "example": "uv"
    },
    "package_spec": {
      "type": "string",
      "description": "Pip-installable package spec for Phase 6 pip installer. None for builtin services (echo, clock) that have no install step.",
      "example": "-e ./repo/echo_http"
    },
    "entry_argv": {
      "description": "argv for process_manager.start() \u2014 first element is the executable (typically `python`), supports ${PORT} substitution from the allocated port",
      "example": [
        "python",
        "-m",
        "echo_http",
        "--port",
        "${PORT}"
      ],
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "entry_in_process": {
      "description": "In-process service entry point. Mutually exclusive with entry_argv. The framework's InProcessAdapter loads <repo>/<name>/<version>/<module>.py and instantiates <class>.",
      "example": {
        "module": "clock",
        "class": "ClockService"
      },
      "type": "object",
      "properties": {
        "module": {
          "type": "string"
        },
        "class": {
          "type": "string"
        }
      }
    },
    "rating": {
      "type": "number",
      "description": "Average user rating 0.0 to 5.0",
      "example": 4.5
    },
    "tags": {
      "description": "Descriptive tags for discoverability",
      "example": [
        "vision",
        "camera"
      ],
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "implements": {
      "description": "Capability interfaces this service implements. Other services discover compatible peers by filtering for the interface name.",
      "example": [
        "servo_controller"
      ],
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "requires": {
      "description": "Capability interfaces this service requires to attach to. UI uses this to filter the attach-controller dropdown.",
      "example": [
        "servo_controller"
      ],
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "author": {
      "type": "string",
      "description": "Service author or organization",
      "example": "CloudSeeder"
    },
    "homepage": {
      "type": "string",
      "description": "URL to documentation or repository"
    },
    "license": {
      "type": "string",
      "description": "License notice/agreement the operator must accept once before the type installs. None means no license gate. Read from package.yml; shown by the install wizard."
    },
    "wizard_steps": {
      "description": "Install-time wizard step definitions shown before installation begins",
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": true,
        "properties": {
          "id": {
            "type": "string"
          },
          "title": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "fields": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": true
            }
          }
        }
      }
    },
    "wizard_schema": {
      "description": "JSON Schema Draft-7 for install-time wizard values \u2014 validated by ajv in doInstall()",
      "type": "object",
      "additionalProperties": true
    },
    "install_steps": {
      "description": "Automated installation step definitions executed by the backend",
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": true,
        "properties": {
          "id": {
            "type": "string"
          },
          "action": {
            "type": "string"
          },
          "label": {
            "type": "string"
          },
          "description": {
            "type": "string"
          }
        }
      }
    },
    "config_steps": {
      "description": "Per-instance configuration wizard steps shown on first Start",
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": true,
        "properties": {
          "id": {
            "type": "string"
          },
          "title": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "fields": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": true
            }
          }
        }
      }
    },
    "config_schema": {
      "description": "JSON Schema Draft-7 for per-instance config values \u2014 validated by ajv in doStart()",
      "type": "object",
      "additionalProperties": true
    },
    "ui_schema": {
      "description": "RJSF ui:schema for per-instance config form rendering hints (e.g. password widgets, field order)",
      "type": "object",
      "additionalProperties": true
    },
    "ui": {
      "description": "Modular service-UI bundle descriptor (Option B \u2014 see docs/TODO_SERVICE_UI_BUNDLES.md). When present, the service ships a pre-built frontend ESM the host dynamically imports instead of a built-in serviceViews component. Shape \u2014 entry='ui/dist/ui.js', css?='ui/dist/ui.css', sdk='^1.0'. None = no bundled UI.",
      "type": "object",
      "additionalProperties": true
    }
  },
  "required": [
    "name",
    "version"
  ]
}
