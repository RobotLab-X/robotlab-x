// managed
// Alias interface for use across the project
export interface Alias {
  id?: string;
  workspace_id: string;
  name: string;
  target_type: string;
  target_id: string;
  description?: string;
}

export function createEmptyAlias(): Alias {
  return {
    id: undefined,
    workspace_id: "",
    name: "",
    target_type: "",
    target_id: "",
    description: undefined,
  };
}

// Helper function to validate Alias object
export function isAlias(obj: any): obj is Alias {
  return obj && typeof obj === 'object';
}

// Helper function to clone Alias object
export function cloneAlias(item: Alias): Alias {
  return {
    ...item,
  };
}

// JSON Schema for Fastify route validation and OpenAPI documentation
export const AliasSchema = {
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Primary key - set to workspace_id/name on create",
      "example": "vision-pipeline/vision"
    },
    "workspace_id": {
      "type": "string",
      "description": "Parent workspace name",
      "example": "vision-pipeline"
    },
    "name": {
      "type": "string",
      "description": "The alias short name used in message routing",
      "example": "vision"
    },
    "target_type": {
      "type": "string",
      "description": "What the alias resolves to - service_proxy, topic, or subscription",
      "example": "service_proxy"
    },
    "target_id": {
      "type": "string",
      "description": "The actual id of the target being aliased",
      "example": "pycv"
    },
    "description": {
      "type": "string",
      "description": "Human-readable explanation of this alias mapping"
    }
  },
  "required": [
    "workspace_id",
    "name",
    "target_type",
    "target_id"
  ]
}
