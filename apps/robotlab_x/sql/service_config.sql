-- managed
-- SQL migration for service_config table in robotlab_x
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "service_config" (
    "id" TEXT PRIMARY KEY,
    "service_proxy_id" TEXT,
    "service_meta_id" TEXT,
    "params" JSONB
);

-- Add any missing columns to an existing table
ALTER TABLE "service_config" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "service_config" ADD COLUMN IF NOT EXISTS "service_proxy_id" TEXT;
ALTER TABLE "service_config" ADD COLUMN IF NOT EXISTS "service_meta_id" TEXT;
ALTER TABLE "service_config" ADD COLUMN IF NOT EXISTS "params" JSONB;
