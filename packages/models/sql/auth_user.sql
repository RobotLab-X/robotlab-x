-- managed
-- SQL migration for auth_user table in packages
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "auth_user" (
    "id" TEXT PRIMARY KEY,
    "tenant_id" TEXT,
    "external_id" TEXT,
    "email" TEXT,
    "email_verified" BOOLEAN,
    "fullname" TEXT,
    "given_name" TEXT,
    "family_name" TEXT,
    "phone" TEXT,
    "avatar_url" TEXT,
    "roles" JSONB,
    "permissions" JSONB,
    "status" TEXT,
    "auth_provider" TEXT,
    "password_hash" TEXT,
    "password_updated_at" BIGINT,
    "is_mfa_enabled" BOOLEAN,
    "totp_secret" TEXT,
    "login_count" BIGINT,
    "last_login" BIGINT,
    "last_unsuccessful_login" BIGINT,
    "failed_login_count" BIGINT,
    "locked_until" BIGINT,
    "accepted_tos_date" BIGINT,
    "created" BIGINT,
    "modified" BIGINT
);

-- Add any missing columns to an existing table
ALTER TABLE "auth_user" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "auth_user" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
ALTER TABLE "auth_user" ADD COLUMN IF NOT EXISTS "external_id" TEXT;
ALTER TABLE "auth_user" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "auth_user" ADD COLUMN IF NOT EXISTS "email_verified" BOOLEAN;
ALTER TABLE "auth_user" ADD COLUMN IF NOT EXISTS "fullname" TEXT;
ALTER TABLE "auth_user" ADD COLUMN IF NOT EXISTS "given_name" TEXT;
ALTER TABLE "auth_user" ADD COLUMN IF NOT EXISTS "family_name" TEXT;
ALTER TABLE "auth_user" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "auth_user" ADD COLUMN IF NOT EXISTS "avatar_url" TEXT;
ALTER TABLE "auth_user" ADD COLUMN IF NOT EXISTS "roles" JSONB;
ALTER TABLE "auth_user" ADD COLUMN IF NOT EXISTS "permissions" JSONB;
ALTER TABLE "auth_user" ADD COLUMN IF NOT EXISTS "status" TEXT;
ALTER TABLE "auth_user" ADD COLUMN IF NOT EXISTS "auth_provider" TEXT;
ALTER TABLE "auth_user" ADD COLUMN IF NOT EXISTS "password_hash" TEXT;
ALTER TABLE "auth_user" ADD COLUMN IF NOT EXISTS "password_updated_at" BIGINT;
ALTER TABLE "auth_user" ADD COLUMN IF NOT EXISTS "is_mfa_enabled" BOOLEAN;
ALTER TABLE "auth_user" ADD COLUMN IF NOT EXISTS "totp_secret" TEXT;
ALTER TABLE "auth_user" ADD COLUMN IF NOT EXISTS "login_count" BIGINT;
ALTER TABLE "auth_user" ADD COLUMN IF NOT EXISTS "last_login" BIGINT;
ALTER TABLE "auth_user" ADD COLUMN IF NOT EXISTS "last_unsuccessful_login" BIGINT;
ALTER TABLE "auth_user" ADD COLUMN IF NOT EXISTS "failed_login_count" BIGINT;
ALTER TABLE "auth_user" ADD COLUMN IF NOT EXISTS "locked_until" BIGINT;
ALTER TABLE "auth_user" ADD COLUMN IF NOT EXISTS "accepted_tos_date" BIGINT;
ALTER TABLE "auth_user" ADD COLUMN IF NOT EXISTS "created" BIGINT;
ALTER TABLE "auth_user" ADD COLUMN IF NOT EXISTS "modified" BIGINT;
