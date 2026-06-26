// managed
// Script interface for use across the project
export interface Script {
  id?: string;
  name: string;
  language: "python";
  body?: string;
  created_at?: string;
  updated_at?: string;
}

export function createEmptyScript(): Script {
  return {
    id: undefined,
    name: "",
    language: "python",
    body: "",
    created_at: undefined,
    updated_at: undefined,
  };
}

// Helper function to validate Script object
export function isScript(obj: any): obj is Script {
  return obj && typeof obj === 'object';
}

// Helper function to clone Script object
export function cloneScript(item: Script): Script {
  return {
    ...item,
  };
}

// JSON Schema for Fastify route validation and OpenAPI documentation
export const ScriptSchema = {
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Primary key - UUID auto-generated on create",
      "example": "script-123"
    },
    "name": {
      "type": "string",
      "description": "Human-readable name for this script",
      "example": "hello-world"
    },
    "language": {
      "type": "string",
      "enum": [
        "python"
      ],
      "description": "Script language (Python only in Phase 5; more in later phases)",
      "example": "python"
    },
    "body": {
      "type": "string",
      "description": "Source code of the script",
      "example": "print('hello')"
    },
    "created_at": {
      "type": "string",
      "description": "ISO-8601 timestamp when the script was created"
    },
    "updated_at": {
      "type": "string",
      "description": "ISO-8601 timestamp when the script was last saved"
    }
  },
  "required": [
    "name",
    "language"
  ]
}
