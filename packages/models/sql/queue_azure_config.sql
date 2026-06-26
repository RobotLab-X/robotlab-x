-- managed
-- SQL migration for queue_azure_config table in packages
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "queue_azure_config" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT,
    "queue_name" TEXT,
    "connection_string" TEXT,
    "region_name" TEXT
);

-- Add any missing columns to an existing table
ALTER TABLE "queue_azure_config" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "queue_azure_config" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "queue_azure_config" ADD COLUMN IF NOT EXISTS "queue_name" TEXT;
ALTER TABLE "queue_azure_config" ADD COLUMN IF NOT EXISTS "connection_string" TEXT;
ALTER TABLE "queue_azure_config" ADD COLUMN IF NOT EXISTS "region_name" TEXT;
