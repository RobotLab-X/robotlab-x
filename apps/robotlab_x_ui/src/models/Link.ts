// managed
// Link interface for use across the project
export interface Link {
  id?: string;
  source_proxy_id?: string;
  source_topic?: string;
  target_proxy_id?: string;
  target_sink?: string;
  kind?: string;
  origin?: string;
}

export function createEmptyLink(): Link {
  return {
    id: undefined,
    source_proxy_id: undefined,
    source_topic: undefined,
    target_proxy_id: undefined,
    target_sink: undefined,
    kind: undefined,
    origin: undefined,
  };
}

// Helper function to validate Link object
export function isLink(obj: any): obj is Link {
  return obj && typeof obj === 'object';
}

// Helper function to clone Link object
export function cloneLink(item: Link): Link {
  return {
    ...item,
  };
}

// JSON Schema for Fastify route validation and OpenAPI documentation
export const LinkSchema = {
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Stable link key - source_proxy/source_topic->target_proxy/target_sink"
    },
    "source_proxy_id": {
      "type": "string",
      "description": "Proxy id the data flows FROM (the publisher / the consumer holding the binding)"
    },
    "source_topic": {
      "type": "string",
      "description": "Bus topic carrying the data, when the link is a topic subscription"
    },
    "target_proxy_id": {
      "type": "string",
      "description": "Proxy id the data flows TO (the subscriber / the referenced controller)"
    },
    "target_sink": {
      "type": "string",
      "description": "Channel id, pin, or capability slot on the consumer that receives the data"
    },
    "kind": {
      "type": "string",
      "description": "Link kind - input (topic subscription) or capability (controller binding)",
      "example": "input"
    },
    "origin": {
      "type": "string",
      "description": "declared (from config) | observed (live bus) | both",
      "example": "both"
    }
  }
}
