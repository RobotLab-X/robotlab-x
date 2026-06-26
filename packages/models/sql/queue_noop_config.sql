-- managed
-- SQL migration for queue_noop_config table in packages
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "queue_noop_config" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT
);

-- Add any missing columns to an existing table
ALTER TABLE "queue_noop_config" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "queue_noop_config" ADD COLUMN IF NOT EXISTS "name" TEXT;
