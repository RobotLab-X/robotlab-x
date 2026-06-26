// managed
// Workspace interface for use across the project
export interface Workspace {
  id?: string;
  name: string;
  description?: string;
  status?: string;
  kind?: string;
  service_proxy_ids?: any;
  node_positions?: any;
  node_view_types?: any;
  edges?: any;
  dashboard?: any;
  viewport?: any;
  activated_at?: string;
  created_at?: string;
  updated_at?: string;
}

export function createEmptyWorkspace(): Workspace {
  return {
    id: undefined,
    name: "",
    description: undefined,
    status: "draft",
    kind: "user",
    service_proxy_ids: undefined,
    node_positions: undefined,
    node_view_types: undefined,
    edges: undefined,
    dashboard: undefined,
    viewport: undefined,
    activated_at: undefined,
    created_at: undefined,
    updated_at: undefined,
  };
}

// Helper function to validate Workspace object
export function isWorkspace(obj: any): obj is Workspace {
  return obj && typeof obj === 'object';
}

// Helper function to clone Workspace object
export function cloneWorkspace(item: Workspace): Workspace {
  return {
    ...item,
  };
}

// JSON Schema for Fastify route validation and OpenAPI documentation
export const WorkspaceSchema = {
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Primary key - set to workspace name on create",
      "example": "vision-pipeline"
    },
    "name": {
      "type": "string",
      "description": "Unique workspace name",
      "example": "vision-pipeline"
    },
    "description": {
      "type": "string",
      "description": "Human-readable description of this workspace"
    },
    "status": {
      "type": "string",
      "description": "Workspace state - draft, active, inactive",
      "example": "active"
    },
    "kind": {
      "type": "string",
      "description": "Workspace kind - 'user' (saved grouping) or 'runtime' (singleton live view of running services)",
      "example": "user",
      "enum": [
        "user",
        "runtime"
      ]
    },
    "service_proxy_ids": {
      "description": "Explicit list of service proxy names that belong to this workspace. For kind='runtime' this is computed from the registry (running services only) and not stored.",
      "example": [
        "pycv",
        "cam",
        "ollama-main"
      ],
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "node_positions": {
      "description": "Canvas position for each proxy node, keyed by proxy name",
      "example": {
        "cam": {
          "x": 80,
          "y": 80
        }
      },
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "properties": {
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          }
        },
        "required": [
          "x",
          "y"
        ]
      }
    },
    "node_view_types": {
      "description": "Per-node visual variant on this canvas, keyed by proxy name. Values are 'view_min' (pill), 'view_name_and_type' (default, current shape), or 'view_full' (loads a service-type-specific UI keyed by service_meta_id).",
      "example": {
        "cam": "view_min"
      },
      "type": "object",
      "additionalProperties": {
        "type": "string",
        "enum": [
          "view_min",
          "view_name_and_type",
          "view_full"
        ]
      }
    },
    "edges": {
      "description": "Persisted React Flow edges (message routes) between service nodes on this canvas",
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": true
      }
    },
    "dashboard": {
      "description": "Dashboard widget configuration and layout \u2014 persisted as { widgets:WidgetConfig[], layout:Layout[] }",
      "type": "object",
      "additionalProperties": true
    },
    "viewport": {
      "description": "Canvas viewport state \u2014 pan offset (x, y) and zoom level",
      "example": {
        "x": 0,
        "y": 0,
        "zoom": 0.5
      },
      "type": "object",
      "properties": {
        "x": {
          "type": "number"
        },
        "y": {
          "type": "number"
        },
        "zoom": {
          "type": "number",
          "minimum": 0.1,
          "maximum": 2.0
        }
      },
      "required": [
        "x",
        "y",
        "zoom"
      ]
    },
    "activated_at": {
      "type": "string",
      "description": "ISO-8601 timestamp of the last activate_workspace call - null when inactive. Used on boot to restore previously-running workspaces."
    },
    "created_at": {
      "type": "string",
      "description": "ISO-8601 timestamp when the workspace was created"
    },
    "updated_at": {
      "type": "string",
      "description": "ISO-8601 timestamp when the workspace was last modified"
    }
  },
  "required": [
    "name"
  ]
}
