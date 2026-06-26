// managed
// Subscription interface for use across the project
export interface Subscription {
  id?: string;
  workspace_id: string;
  topic_id: string;
  subscriber_proxy_id: string;
  method?: string;
  filter?: any;
}

export function createEmptySubscription(): Subscription {
  return {
    id: undefined,
    workspace_id: "",
    topic_id: "",
    subscriber_proxy_id: "",
    method: undefined,
    filter: undefined,
  };
}

// Helper function to validate Subscription object
export function isSubscription(obj: any): obj is Subscription {
  return obj && typeof obj === 'object';
}

// Helper function to clone Subscription object
export function cloneSubscription(item: Subscription): Subscription {
  return {
    ...item,
  };
}

// JSON Schema for Fastify route validation and OpenAPI documentation
export const SubscriptionSchema = {
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "UUID auto-generated on create"
    },
    "workspace_id": {
      "type": "string",
      "description": "Parent workspace name",
      "example": "vision-pipeline"
    },
    "topic_id": {
      "type": "string",
      "description": "Topic this subscription listens to - workspace_id/name",
      "example": "vision-pipeline//camera/rgb"
    },
    "subscriber_proxy_id": {
      "type": "string",
      "description": "Service proxy that receives messages from this topic",
      "example": "pycv"
    },
    "method": {
      "type": "string",
      "description": "Callback method name to invoke on the subscriber",
      "example": "process_frame"
    },
    "filter": {
      "description": "Optional message filter criteria applied before delivery",
      "example": {
        "min_confidence": 0.8
      }
    }
  },
  "required": [
    "workspace_id",
    "topic_id",
    "subscriber_proxy_id"
  ]
}
