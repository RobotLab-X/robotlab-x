-- managed
-- SQL migration for auth_oauth_provider_config table in packages
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "auth_oauth_provider_config" (
    "id" TEXT PRIMARY KEY,
    "provider_id" TEXT,
    "name" TEXT,
    "authorize_url" TEXT,
    "token_url" TEXT,
    "issuer" TEXT,
    "client_id" TEXT,
    "redirect_uri" TEXT,
    "scopes" JSONB,
    "state" TEXT,
    "access_type" TEXT,
    "prompt" TEXT,
    "include_granted_scopes" BOOLEAN,
    "pkce_required" BOOLEAN,
    "response_type" TEXT,
    "response_mode" TEXT,
    "userinfo_url" TEXT,
    "logout_url" TEXT,
    "extra_auth_params" JSONB,
    "client_secret" TEXT
);

-- Add any missing columns to an existing table
ALTER TABLE "auth_oauth_provider_config" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "auth_oauth_provider_config" ADD COLUMN IF NOT EXISTS "provider_id" TEXT;
ALTER TABLE "auth_oauth_provider_config" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "auth_oauth_provider_config" ADD COLUMN IF NOT EXISTS "authorize_url" TEXT;
ALTER TABLE "auth_oauth_provider_config" ADD COLUMN IF NOT EXISTS "token_url" TEXT;
ALTER TABLE "auth_oauth_provider_config" ADD COLUMN IF NOT EXISTS "issuer" TEXT;
ALTER TABLE "auth_oauth_provider_config" ADD COLUMN IF NOT EXISTS "client_id" TEXT;
ALTER TABLE "auth_oauth_provider_config" ADD COLUMN IF NOT EXISTS "redirect_uri" TEXT;
ALTER TABLE "auth_oauth_provider_config" ADD COLUMN IF NOT EXISTS "scopes" JSONB;
ALTER TABLE "auth_oauth_provider_config" ADD COLUMN IF NOT EXISTS "state" TEXT;
ALTER TABLE "auth_oauth_provider_config" ADD COLUMN IF NOT EXISTS "access_type" TEXT;
ALTER TABLE "auth_oauth_provider_config" ADD COLUMN IF NOT EXISTS "prompt" TEXT;
ALTER TABLE "auth_oauth_provider_config" ADD COLUMN IF NOT EXISTS "include_granted_scopes" BOOLEAN;
ALTER TABLE "auth_oauth_provider_config" ADD COLUMN IF NOT EXISTS "pkce_required" BOOLEAN;
ALTER TABLE "auth_oauth_provider_config" ADD COLUMN IF NOT EXISTS "response_type" TEXT;
ALTER TABLE "auth_oauth_provider_config" ADD COLUMN IF NOT EXISTS "response_mode" TEXT;
ALTER TABLE "auth_oauth_provider_config" ADD COLUMN IF NOT EXISTS "userinfo_url" TEXT;
ALTER TABLE "auth_oauth_provider_config" ADD COLUMN IF NOT EXISTS "logout_url" TEXT;
ALTER TABLE "auth_oauth_provider_config" ADD COLUMN IF NOT EXISTS "extra_auth_params" JSONB;
ALTER TABLE "auth_oauth_provider_config" ADD COLUMN IF NOT EXISTS "client_secret" TEXT;
