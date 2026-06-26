-- managed
-- SQL migration for config table in robotlab_x
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "config" (
    "id" TEXT PRIMARY KEY,
    "database_type" TEXT,
    "data_dir" TEXT,
    "repo_dir" TEXT,
    "repo_paths" TEXT,
    "registries" TEXT,
    "jwt_access_token_ttl_minutes" BIGINT,
    "runtime_id" TEXT,
    "registry_url" TEXT,
    "auth_bootstrap" TEXT
);

-- Add any missing columns to an existing table
ALTER TABLE "config" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "config" ADD COLUMN IF NOT EXISTS "database_type" TEXT;
ALTER TABLE "config" ADD COLUMN IF NOT EXISTS "data_dir" TEXT;
ALTER TABLE "config" ADD COLUMN IF NOT EXISTS "repo_dir" TEXT;
ALTER TABLE "config" ADD COLUMN IF NOT EXISTS "repo_paths" TEXT;
ALTER TABLE "config" ADD COLUMN IF NOT EXISTS "registries" TEXT;
ALTER TABLE "config" ADD COLUMN IF NOT EXISTS "jwt_access_token_ttl_minutes" BIGINT;
ALTER TABLE "config" ADD COLUMN IF NOT EXISTS "runtime_id" TEXT;
ALTER TABLE "config" ADD COLUMN IF NOT EXISTS "registry_url" TEXT;
ALTER TABLE "config" ADD COLUMN IF NOT EXISTS "auth_bootstrap" TEXT;
