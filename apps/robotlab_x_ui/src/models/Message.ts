// managed
// Message interface for use across the project
export interface Message {
  id?: string;
  name?: string;
  type?: string;
  method: string;
  data?: any;
  reply_to?: string;
}

export function createEmptyMessage(): Message {
  return {
    id: undefined,
    name: undefined,
    type: undefined,
    method: "",
    data: undefined,
    reply_to: undefined,
  };
}

// Helper function to validate Message object
export function isMessage(obj: any): obj is Message {
  return obj && typeof obj === 'object';
}

// Helper function to clone Message object
export function cloneMessage(item: Message): Message {
  return {
    ...item,
  };
}

// JSON Schema for Fastify route validation and OpenAPI documentation
export const MessageSchema = {
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Transcription Request ID - can be created by client or will be self generated",
      "example": "123e4567-e89b-12d3-a456-426614174000"
    },
    "name": {
      "type": "string",
      "description": "the unique service name / topic \u2014 None would be simple broadcast",
      "example": "ollama@rbx.com"
    },
    "type": {
      "type": "string",
      "description": "service"
    },
    "method": {
      "type": "string",
      "description": "the method to be invoked on the service",
      "example": "visit-1234"
    },
    "data": {
      "description": "the data to be sent to the service",
      "example": {
        "key": "value"
      },
      "type": "object",
      "additionalProperties": true
    },
    "reply_to": {
      "type": "string",
      "description": "the message ID to reply to for request-response patterns",
      "example": "123e4567-e89b-12d3-a456-426614174000"
    }
  },
  "required": [
    "method"
  ]
}
