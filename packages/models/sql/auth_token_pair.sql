-- managed
-- SQL migration for auth_token_pair table in packages
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "auth_token_pair" (
    "access_token" TEXT,
    "refresh_token" TEXT,
    "token_type" TEXT,
    "expires_in" BIGINT,
    "refresh_expires_in" BIGINT,
    "issued_at" BIGINT,
    "access_token_expires_at" BIGINT
);

-- Add any missing columns to an existing table
ALTER TABLE "auth_token_pair" ADD COLUMN IF NOT EXISTS "access_token" TEXT;
ALTER TABLE "auth_token_pair" ADD COLUMN IF NOT EXISTS "refresh_token" TEXT;
ALTER TABLE "auth_token_pair" ADD COLUMN IF NOT EXISTS "token_type" TEXT;
ALTER TABLE "auth_token_pair" ADD COLUMN IF NOT EXISTS "expires_in" BIGINT;
ALTER TABLE "auth_token_pair" ADD COLUMN IF NOT EXISTS "refresh_expires_in" BIGINT;
ALTER TABLE "auth_token_pair" ADD COLUMN IF NOT EXISTS "issued_at" BIGINT;
ALTER TABLE "auth_token_pair" ADD COLUMN IF NOT EXISTS "access_token_expires_at" BIGINT;
