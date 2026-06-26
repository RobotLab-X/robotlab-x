// managed
// Service Config interface for use across the project
export interface ServiceConfig {
  id?: string;
  service_proxy_id: string;
  service_meta_id: string;
  params?: any;
}

export function createEmptyServiceConfig(): ServiceConfig {
  return {
    id: undefined,
    service_proxy_id: "",
    service_meta_id: "",
    params: undefined,
  };
}

// Helper function to validate ServiceConfig object
export function isServiceConfig(obj: any): obj is ServiceConfig {
  return obj && typeof obj === 'object';
}

// Helper function to clone ServiceConfig object
export function cloneServiceConfig(item: ServiceConfig): ServiceConfig {
  return {
    ...item,
  };
}

// JSON Schema for Fastify route validation and OpenAPI documentation
export const ServiceConfigSchema = {
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Primary key - set to service_proxy_id on create",
      "example": "pycv"
    },
    "service_proxy_id": {
      "type": "string",
      "description": "Foreign key - name of the owning service_proxy",
      "example": "pycv"
    },
    "service_meta_id": {
      "type": "string",
      "description": "Denormalized reference to the service catalog entry",
      "example": "opencv@4.8.0"
    },
    "params": {
      "description": "Flexible per-instance configuration - structure varies by service type",
      "example": {
        "resolution": "1920x1080",
        "fps": 30
      },
      "type": "object",
      "additionalProperties": true
    }
  },
  "required": [
    "service_proxy_id",
    "service_meta_id"
  ]
}
