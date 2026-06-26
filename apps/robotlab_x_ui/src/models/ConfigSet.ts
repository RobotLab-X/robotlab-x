// managed
// Config Set interface for use across the project
export interface ConfigSet {
  id?: string;
  name?: string;
  active?: boolean;
  pending?: boolean;
  proxy_count?: number;
  has_runtime_yml?: boolean;
  root_dir?: string;
  path?: string;
  start_order?: any;
  proxies?: any;
  candidates?: any;
}

export function createEmptyConfigSet(): ConfigSet {
  return {
    id: undefined,
    name: undefined,
    active: undefined,
    pending: undefined,
    proxy_count: undefined,
    has_runtime_yml: undefined,
    root_dir: undefined,
    path: undefined,
    start_order: undefined,
    proxies: undefined,
    candidates: undefined,
  };
}

// Helper function to validate ConfigSet object
export function isConfigSet(obj: any): obj is ConfigSet {
  return obj && typeof obj === 'object';
}

// Helper function to clone ConfigSet object
export function cloneConfigSet(item: ConfigSet): ConfigSet {
  return {
    ...item,
  };
}

// JSON Schema for Fastify route validation and OpenAPI documentation
export const ConfigSetSchema = {
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Config set name (primary key)",
      "example": "default"
    },
    "name": {
      "type": "string",
      "description": "Config set name"
    },
    "active": {
      "type": "boolean",
      "description": "True if this is the LIVE booted set (what the process reads and writes)"
    },
    "pending": {
      "type": "boolean",
      "description": "True if this set is marked to boot next (differs from active until a restart)"
    },
    "proxy_count": {
      "type": "integer",
      "description": "Number of per-proxy yml files in the set"
    },
    "has_runtime_yml": {
      "type": "boolean",
      "description": "Whether the set has a runtime.yml"
    },
    "root_dir": {
      "type": "string",
      "description": "Absolute path of the parent config_sets directory"
    },
    "path": {
      "type": "string",
      "description": "Absolute path of this set's directory"
    },
    "start_order": {
      "description": "Ordered proxy ids the set starts on boot (detail view only)",
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "proxies": {
      "description": "Per-proxy file info in start_order (detail view only)",
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": true
      }
    },
    "candidates": {
      "description": "Per-proxy file info not in start_order (detail view only)",
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": true
      }
    }
  }
}
