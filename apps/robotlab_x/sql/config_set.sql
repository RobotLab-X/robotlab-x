-- managed
-- SQL migration for config_set table in robotlab_x
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "config_set" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT,
    "active" BOOLEAN,
    "pending" BOOLEAN,
    "proxy_count" BIGINT,
    "has_runtime_yml" BOOLEAN,
    "root_dir" TEXT,
    "path" TEXT,
    "start_order" TEXT,
    "proxies" TEXT,
    "candidates" TEXT
);

-- Add any missing columns to an existing table
ALTER TABLE "config_set" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "config_set" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "config_set" ADD COLUMN IF NOT EXISTS "active" BOOLEAN;
ALTER TABLE "config_set" ADD COLUMN IF NOT EXISTS "pending" BOOLEAN;
ALTER TABLE "config_set" ADD COLUMN IF NOT EXISTS "proxy_count" BIGINT;
ALTER TABLE "config_set" ADD COLUMN IF NOT EXISTS "has_runtime_yml" BOOLEAN;
ALTER TABLE "config_set" ADD COLUMN IF NOT EXISTS "root_dir" TEXT;
ALTER TABLE "config_set" ADD COLUMN IF NOT EXISTS "path" TEXT;
ALTER TABLE "config_set" ADD COLUMN IF NOT EXISTS "start_order" TEXT;
ALTER TABLE "config_set" ADD COLUMN IF NOT EXISTS "proxies" TEXT;
ALTER TABLE "config_set" ADD COLUMN IF NOT EXISTS "candidates" TEXT;
