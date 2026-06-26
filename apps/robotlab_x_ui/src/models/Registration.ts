// managed
// Registration interface for use across the project
export interface Registration {
  id?: string;
  user_id?: string;
  email?: string;
  fullname?: string;
  password_hash?: string;
  password?: string;
  state?: "registered" | "verified";
  verification_token?: string;
  created?: number;
  client_base_url?: string;
}

export function createEmptyRegistration(): Registration {
  return {
    id: undefined,
    user_id: undefined,
    email: undefined,
    fullname: undefined,
    password_hash: undefined,
    password: undefined,
    state: "registered",
    verification_token: undefined,
    created: undefined,
    client_base_url: undefined,
  };
}

// Helper function to validate Registration object
export function isRegistration(obj: any): obj is Registration {
  return obj && typeof obj === 'object';
}

// Helper function to clone Registration object
export function cloneRegistration(item: Registration): Registration {
  return {
    ...item,
  };
}

// JSON Schema for Fastify route validation and OpenAPI documentation
export const RegistrationSchema = {
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Verification token (UUID)",
      "example": "123e4567-e89b-12d3-a456-426614174000"
    },
    "user_id": {
      "type": "string",
      "description": "Future user ID (typically email)",
      "example": "john@company.com"
    },
    "email": {
      "type": "string",
      "description": "User email address",
      "example": "john@company.com"
    },
    "fullname": {
      "type": "string",
      "description": "User full name",
      "example": "John Doe"
    },
    "password_hash": {
      "type": "string",
      "description": "Hashed password",
      "example": "$2b$12$abcdefg..."
    },
    "password": {
      "type": "string",
      "description": "Temporary password field (not stored)",
      "example": "SecurePass123!"
    },
    "state": {
      "type": "string",
      "enum": [
        "registered",
        "verified"
      ],
      "description": "Registration state - server will set to 'registered' if not provided",
      "example": "registered"
    },
    "verification_token": {
      "type": "string",
      "description": "Verification token",
      "example": "123e4567-e89b-12d3-a456-426614174000"
    },
    "created": {
      "type": "integer",
      "description": "Created timestamp in milliseconds",
      "example": 1683123456789
    },
    "client_base_url": {
      "type": "string",
      "description": "Base URL for the client",
      "example": "http://localhost:3020"
    }
  }
}
