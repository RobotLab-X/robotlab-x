// managed
// Service Proxy interface for use across the project
export interface ServiceProxy {
  id?: string;
  name: string;
  service_meta_id: string;
  status?: string;
  configured?: boolean;
  pid?: number;
  host?: string;
  port?: number;
  created_at?: string;
  started_at?: string;
  stopped_at?: string;
  error?: string;
  service_config?: any;
}

export function createEmptyServiceProxy(): ServiceProxy {
  return {
    id: undefined,
    name: "",
    service_meta_id: "",
    status: "stopped",
    configured: undefined,
    pid: undefined,
    host: undefined,
    port: undefined,
    created_at: undefined,
    started_at: undefined,
    stopped_at: undefined,
    error: undefined,
    service_config: undefined,
  };
}

// Helper function to validate ServiceProxy object
export function isServiceProxy(obj: any): obj is ServiceProxy {
  return obj && typeof obj === 'object';
}

// Helper function to clone ServiceProxy object
export function cloneServiceProxy(item: ServiceProxy): ServiceProxy {
  return {
    ...item,
  };
}

// JSON Schema for Fastify route validation and OpenAPI documentation
export const ServiceProxySchema = {
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Primary key - set to proxy name on create",
      "example": "pycv"
    },
    "name": {
      "type": "string",
      "description": "Unique human-readable name for this running instance",
      "example": "pycv"
    },
    "service_meta_id": {
      "type": "string",
      "description": "Service catalog reference in name@version format",
      "example": "opencv@4.8.0"
    },
    "status": {
      "type": "string",
      "description": "Runtime state - stopped, installing, installed, starting, running, stopping, error",
      "example": "running"
    },
    "configured": {
      "type": "boolean",
      "description": "Whether this proxy instance has been configured via the config wizard"
    },
    "pid": {
      "type": "integer",
      "description": "OS process ID when the service is running"
    },
    "host": {
      "type": "string",
      "description": "Hostname or IP the service is bound to",
      "example": "127.0.0.1"
    },
    "port": {
      "type": "integer",
      "description": "Port the service is listening on",
      "example": 7070
    },
    "created_at": {
      "type": "string",
      "description": "ISO-8601 timestamp when the proxy record was created"
    },
    "started_at": {
      "type": "string",
      "description": "ISO-8601 timestamp of the most recent successful start"
    },
    "stopped_at": {
      "type": "string",
      "description": "ISO-8601 timestamp of the most recent stop or crash"
    },
    "error": {
      "type": "string",
      "description": "Last error message if status is error"
    },
    "service_config": {
      "description": "Per-instance configuration params populated by the config wizard \u2014 mirrors service_config.params for this proxy",
      "type": "object",
      "additionalProperties": true
    }
  },
  "required": [
    "name",
    "service_meta_id"
  ]
}
