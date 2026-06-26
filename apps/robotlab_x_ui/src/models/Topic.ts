// managed
// Topic interface for use across the project
export interface Topic {
  id?: string;
  workspace_id: string;
  name: string;
  message_type?: string;
  description?: string;
  publisher_proxy_id?: string;
  retained?: boolean;
  qos?: any;
}

export function createEmptyTopic(): Topic {
  return {
    id: undefined,
    workspace_id: "",
    name: "",
    message_type: undefined,
    description: undefined,
    publisher_proxy_id: undefined,
    retained: false,
    qos: undefined,
  };
}

// Helper function to validate Topic object
export function isTopic(obj: any): obj is Topic {
  return obj && typeof obj === 'object';
}

// Helper function to clone Topic object
export function cloneTopic(item: Topic): Topic {
  return {
    ...item,
  };
}

// JSON Schema for Fastify route validation and OpenAPI documentation
export const TopicSchema = {
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Primary key - set to workspace_id/name on create",
      "example": "vision-pipeline//camera/rgb"
    },
    "workspace_id": {
      "type": "string",
      "description": "Parent workspace name",
      "example": "vision-pipeline"
    },
    "name": {
      "type": "string",
      "description": "Topic channel name - use ROS2-style slash-prefixed paths",
      "example": "/camera/rgb/image_raw"
    },
    "message_type": {
      "type": "string",
      "description": "Message type identifier - e.g. Image, PointCloud, or custom",
      "example": "Image"
    },
    "description": {
      "type": "string",
      "description": "Human-readable description of what this topic carries"
    },
    "publisher_proxy_id": {
      "type": "string",
      "description": "Service proxy that publishes to this topic - None means external or anonymous publisher",
      "example": "cam"
    },
    "retained": {
      "type": "boolean",
      "description": "Whether to keep the last message for late subscribers"
    },
    "qos": {
      "description": "Quality of service settings - reliability, history, depth",
      "example": {
        "reliability": "reliable",
        "history": "keep_last",
        "depth": 10
      },
      "type": "object",
      "properties": {
        "reliability": {
          "type": "string",
          "enum": [
            "reliable",
            "best_effort"
          ]
        },
        "history": {
          "type": "string",
          "enum": [
            "keep_last",
            "keep_all"
          ]
        },
        "depth": {
          "type": "integer"
        }
      }
    }
  },
  "required": [
    "workspace_id",
    "name"
  ]
}
