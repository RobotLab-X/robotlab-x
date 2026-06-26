-- managed
-- SQL migration for auth_session table in packages
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "auth_session" (
    "id" TEXT PRIMARY KEY,
    "user_id" TEXT,
    "tenant_id" TEXT,
    "refresh_token_hash" TEXT,
    "status" TEXT,
    "created" BIGINT,
    "expires_at" BIGINT,
    "revoked_at" BIGINT,
    "last_used_at" BIGINT,
    "user_agent" TEXT,
    "ip_address" TEXT
);

-- Add any missing columns to an existing table
ALTER TABLE "auth_session" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "auth_session" ADD COLUMN IF NOT EXISTS "user_id" TEXT;
ALTER TABLE "auth_session" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
ALTER TABLE "auth_session" ADD COLUMN IF NOT EXISTS "refresh_token_hash" TEXT;
ALTER TABLE "auth_session" ADD COLUMN IF NOT EXISTS "status" TEXT;
ALTER TABLE "auth_session" ADD COLUMN IF NOT EXISTS "created" BIGINT;
ALTER TABLE "auth_session" ADD COLUMN IF NOT EXISTS "expires_at" BIGINT;
ALTER TABLE "auth_session" ADD COLUMN IF NOT EXISTS "revoked_at" BIGINT;
ALTER TABLE "auth_session" ADD COLUMN IF NOT EXISTS "last_used_at" BIGINT;
ALTER TABLE "auth_session" ADD COLUMN IF NOT EXISTS "user_agent" TEXT;
ALTER TABLE "auth_session" ADD COLUMN IF NOT EXISTS "ip_address" TEXT;
