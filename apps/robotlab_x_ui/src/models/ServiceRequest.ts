// managed
// Service Request interface for use across the project
export interface ServiceRequest {
  id?: string;
  action: string;
  service_meta_id?: string;
  proxy_name?: string;
  workspace_id?: string;
  service_proxy_id?: string;
  config?: any;
  status?: string;
  result?: string;
  created_at?: string;
  completed_at?: string;
}

export function createEmptyServiceRequest(): ServiceRequest {
  return {
    id: undefined,
    action: "",
    service_meta_id: undefined,
    proxy_name: undefined,
    workspace_id: undefined,
    service_proxy_id: undefined,
    config: undefined,
    status: "pending",
    result: undefined,
    created_at: undefined,
    completed_at: undefined,
  };
}

// Helper function to validate ServiceRequest object
export function isServiceRequest(obj: any): obj is ServiceRequest {
  return obj && typeof obj === 'object';
}

// Helper function to clone ServiceRequest object
export function cloneServiceRequest(item: ServiceRequest): ServiceRequest {
  return {
    ...item,
  };
}

// JSON Schema for Fastify route validation and OpenAPI documentation
export const ServiceRequestSchema = {
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "UUID auto-generated on create",
      "example": "123e4567-e89b-12d3-a456-426614174000"
    },
    "action": {
      "type": "string",
      "description": "Lifecycle action - install, start, stop, restart, uninstall, activate_workspace, deactivate_workspace",
      "example": "start"
    },
    "service_meta_id": {
      "type": "string",
      "description": "Target service catalog entry - required for install",
      "example": "opencv@4.8.0"
    },
    "proxy_name": {
      "type": "string",
      "description": "Desired proxy name - required for install to name the new proxy",
      "example": "pycv"
    },
    "workspace_id": {
      "type": "string",
      "description": "Target workspace name for activate_workspace and deactivate_workspace actions",
      "example": "vision-pipeline"
    },
    "service_proxy_id": {
      "type": "string",
      "description": "Target proxy name for start, stop, restart, uninstall actions",
      "example": "pycv"
    },
    "config": {
      "description": "Initial or updated config params to apply alongside this request",
      "example": {
        "port": 7070
      },
      "type": "object",
      "additionalProperties": true
    },
    "status": {
      "type": "string",
      "description": "Request processing state - pending, running, completed, failed",
      "example": "completed"
    },
    "result": {
      "type": "string",
      "description": "Human-readable outcome message or error detail"
    },
    "created_at": {
      "type": "string",
      "description": "ISO-8601 timestamp when the request was submitted"
    },
    "completed_at": {
      "type": "string",
      "description": "ISO-8601 timestamp when the request finished"
    }
  },
  "required": [
    "action"
  ]
}
