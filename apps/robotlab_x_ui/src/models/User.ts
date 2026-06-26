// managed
// User interface for use across the project
export interface User {
  id?: string;
  tenant_id?: string;
  external_id?: string;
  email?: string;
  email_verified?: boolean;
  fullname?: string;
  given_name?: string;
  family_name?: string;
  phone?: string;
  avatar_url?: string;
  roles?: string[];
  permissions?: string[];
  status: "active" | "invited" | "disabled" | "locked";
  auth_provider?: "local" | "oauth" | "unknown";
  password_hash?: string;
  password_updated_at?: number;
  is_mfa_enabled?: boolean;
  totp_secret?: string;
  login_count?: number;
  last_login?: number;
  last_unsuccessful_login?: number;
  failed_login_count?: number;
  locked_until?: number;
  accepted_tos_date?: number;
  created?: number;
  modified?: number;
}

export function createEmptyUser(): User {
  return {
    id: undefined,
    tenant_id: undefined,
    external_id: undefined,
    email: undefined,
    email_verified: false,
    fullname: undefined,
    given_name: undefined,
    family_name: undefined,
    phone: undefined,
    avatar_url: undefined,
    roles: undefined,
    permissions: undefined,
    status: "active",
    auth_provider: "local",
    password_hash: undefined,
    password_updated_at: undefined,
    is_mfa_enabled: false,
    totp_secret: undefined,
    login_count: 0,
    last_login: undefined,
    last_unsuccessful_login: undefined,
    failed_login_count: 0,
    locked_until: undefined,
    accepted_tos_date: undefined,
    created: undefined,
    modified: undefined,
  };
}

// Helper function to validate User object
export function isUser(obj: any): obj is User {
  return obj && typeof obj === 'object';
}

// Helper function to clone User object
export function cloneUser(item: User): User {
  return {
    ...item,
  };
}

// JSON Schema for Fastify route validation and OpenAPI documentation
export const UserSchema = {
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Primary user id (UUID)",
      "example": "123e4567-e89b-12d3-a456-426614174000"
    },
    "tenant_id": {
      "type": "string",
      "description": "Tenant/org identifier for multi-tenant apps",
      "example": "tenant_001"
    },
    "external_id": {
      "type": "string",
      "description": "IdP subject/user id (Okta/Cognito/etc)",
      "example": "00u1abcdEFGH2ijkL3p4"
    },
    "email": {
      "type": "string",
      "example": "john@company.com"
    },
    "email_verified": {
      "type": "boolean",
      "description": "Whether the email address has been verified",
      "example": true
    },
    "fullname": {
      "type": "string",
      "example": "John Doe"
    },
    "given_name": {
      "type": "string",
      "example": "John"
    },
    "family_name": {
      "type": "string",
      "example": "Doe"
    },
    "phone": {
      "type": "string",
      "example": "+1-503-555-1212"
    },
    "avatar_url": {
      "type": "string",
      "example": "https://cdn.example.com/avatar/john.png"
    },
    "roles": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Role names used for authorization",
      "example": [
        "Admin",
        "User"
      ]
    },
    "permissions": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Optional fine-grained permissions",
      "example": [
        "reports.read",
        "reports.write"
      ]
    },
    "status": {
      "type": "string",
      "enum": [
        "active",
        "invited",
        "disabled",
        "locked"
      ],
      "description": "Account lifecycle status",
      "example": "active"
    },
    "auth_provider": {
      "type": "string",
      "enum": [
        "local",
        "oauth",
        "unknown"
      ],
      "description": "Where the user authenticates",
      "example": "okta"
    },
    "password_hash": {
      "type": "string",
      "example": "$2b$12$abcdefghijklmnopqrstuv"
    },
    "password_updated_at": {
      "type": "integer",
      "description": "Epoch ms when password was last changed",
      "example": 1683123456789
    },
    "is_mfa_enabled": {
      "type": "boolean",
      "description": "Enable multi-factor auth",
      "example": true
    },
    "totp_secret": {
      "type": "string",
      "description": "TOTP secret (should be encrypted at rest)",
      "example": "BASE32SECRET"
    },
    "login_count": {
      "type": "integer",
      "example": 5
    },
    "last_login": {
      "type": "integer",
      "example": 1683123456789
    },
    "last_unsuccessful_login": {
      "type": "integer",
      "example": 1683123456789
    },
    "failed_login_count": {
      "type": "integer",
      "description": "Consecutive failed login attempts",
      "example": 2
    },
    "locked_until": {
      "type": "integer",
      "description": "Epoch ms until account lock expires (if locked)",
      "example": 1683127456789
    },
    "accepted_tos_date": {
      "type": "integer",
      "description": "Epoch ms when ToS was accepted",
      "example": 1683123456789
    },
    "created": {
      "type": "integer",
      "example": 1683123456789
    },
    "modified": {
      "type": "integer",
      "example": 1683123456789
    }
  },
  "required": [
    "status"
  ]
}
