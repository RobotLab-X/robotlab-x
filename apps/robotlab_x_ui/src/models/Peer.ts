// managed
// Peer interface for use across the project
export interface Peer {
  id?: string;
  key?: string;
  url?: string;
  remote_id?: string;
  state?: string;
  upstream_subs?: string[];
  collision?: string;
}

export function createEmptyPeer(): Peer {
  return {
    id: undefined,
    key: undefined,
    url: undefined,
    remote_id: undefined,
    state: undefined,
    upstream_subs: undefined,
    collision: undefined,
  };
}

// Helper function to validate Peer object
export function isPeer(obj: any): obj is Peer {
  return obj && typeof obj === 'object';
}

// Helper function to clone Peer object
export function clonePeer(item: Peer): Peer {
  return {
    ...item,
  };
}

// JSON Schema for Fastify route validation and OpenAPI documentation
export const PeerSchema = {
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Peer key \u2014 the remote_id once known, else the connect URL (primary key)"
    },
    "key": {
      "type": "string",
      "description": "Peer key (same as id)"
    },
    "url": {
      "type": "string",
      "description": "WebSocket URL of the remote runtime",
      "example": "ws://10.0.0.5:8998"
    },
    "remote_id": {
      "type": "string",
      "description": "The peer's runtime id once it identifies; null while still connecting"
    },
    "state": {
      "type": "string",
      "description": "Connection state - identifying, connected, disconnected",
      "example": "connected"
    },
    "upstream_subs": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Topic names this runtime subscribes to from the peer (bridged upstream)"
    },
    "collision": {
      "type": "string",
      "description": "Set when the peer's runtime id collides with ours; human-readable detail"
    }
  }
}
