// managed
// Config interface for use across the project
export interface Config {
  id?: string;
  database_type: "postgres" | "lowdb" | "filesystem" | "none";
  data_dir?: string;
  repo_dir?: string;
  repo_paths?: any;
  registries?: any;
  jwt_access_token_ttl_minutes?: number;
  runtime_id?: string;
  registry_url?: string;
  auth_bootstrap: "admin_seed" | "first_user_claim";
}

export function createEmptyConfig(): Config {
  return {
    id: "default",
    database_type: "lowdb",
    data_dir: "data",
    repo_dir: "repo",
    repo_paths: undefined,
    registries: undefined,
    jwt_access_token_ttl_minutes: 1440,
    runtime_id: undefined,
    registry_url: "file:///tmp/repo/catalog.yml",
    auth_bootstrap: "first_user_claim",
  };
}

// Helper function to validate Config object
export function isConfig(obj: any): obj is Config {
  return obj && typeof obj === 'object';
}

// Helper function to clone Config object
export function cloneConfig(item: Config): Config {
  return {
    ...item,
  };
}

// JSON Schema for Fastify route validation and OpenAPI documentation
export const ConfigSchema = {
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Config record id (use 'default' for the singleton app config)",
      "example": "default"
    },
    "database_type": {
      "type": "string",
      "enum": [
        "postgres",
        "lowdb",
        "filesystem",
        "none"
      ],
      "description": "Database backend",
      "example": "lowdb"
    },
    "data_dir": {
      "type": "string",
      "description": "Per-process working directory. Houses databases/ (TinyDB JSON files), runtime_id (federation handle), admin_password.txt, and any other instance-local state. Set per-runtime via ROBOTLAB_X_DATA_DIR; sibling runtimes on the same box use distinct values to keep their state isolated.",
      "example": "data"
    },
    "repo_dir": {
      "type": "string",
      "description": "The WRITABLE service repo root. Loads (downloaded archives) extract here and installs (per-type .venv) build here. Dev uses 'repo' (the monorepo checkout); a frozen bundle uses var/repo (seeded by packaging/entry.py). CWD-relative when not absolute.",
      "example": "repo"
    },
    "repo_paths": {
      "description": "Additional READ-ONLY local repo roots scanned for service types, in order, on top of the writable repo_dir. Lets a runtime reference a separate public robotlab_x-services checkout and/or a private services directory without copying them in. Each entry is a filesystem path to a directory holding <type>/<version>/ dirs. Resolution precedence is writable repo_dir first, then these in listed order, first match per type@version wins. Empty/None in normal dev \u2014 the single repo_dir is enough.",
      "example": [
        "/home/me/robotlab_x-services",
        "/home/me/.rlx/private"
      ],
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "registries": {
      "description": "Ordered list of remote catalog.yml URLs searched for ABSENT types (those not present in any local repo root). The first registry that has a requested type@version serves it. Supports file:// (local mirror) and http(s)://. When empty/None, falls back to the single registry_url. Lets a runtime pull from the public registry plus a private mirror.",
      "example": [
        "https://repo.robotlab-x.com/catalog.yml",
        "file:///tmp/repo/catalog.yml"
      ],
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "jwt_access_token_ttl_minutes": {
      "type": "integer",
      "description": "Access-token JWT lifetime in minutes. The UI refreshes the token via /v1/refresh-token when it expires; this knob controls how often that happens. Default 60.",
      "example": 1440
    },
    "runtime_id": {
      "type": "string",
      "description": "Override the runtime's federation id (the adjective-noun handle peers address us by). Set via ROBOTLAB_X_RUNTIME_ID in .env. When None, identity.py auto-generates + persists one to data/runtime_id.",
      "example": "funny-droid"
    },
    "registry_url": {
      "type": "string",
      "description": "URL of the remote service registry's catalog.yml. The Registry API endpoints (/v1/registry/*) read from here; tools/publish_services.py --target local writes a catalog.yml that this default resolves against. Supports file:// (local mirror) and http(s):// (Phase 5 remote targets).",
      "example": "file:///tmp/repo/catalog.yml"
    },
    "auth_bootstrap": {
      "type": "string",
      "enum": [
        "admin_seed",
        "first_user_claim"
      ],
      "description": "How the user table is initialised on a fresh runtime. 'admin_seed' auto-creates admin@cloudseeder.ai with a generated password. 'first_user_claim' skips that seed and lets the operator establish the first account via POST /v1/auth/claim-first-user \u2014 paired with event_handlers.on_first_user for per-app role assignment. Generator-injected by app.auth.bootstrap.",
      "example": "first_user_claim"
    }
  },
  "required": [
    "database_type",
    "auth_bootstrap"
  ]
}
