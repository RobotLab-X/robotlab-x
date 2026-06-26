-- managed
-- SQL migration for alias table in robotlab_x
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "alias" (
    "id" TEXT PRIMARY KEY,
    "workspace_id" TEXT,
    "name" TEXT,
    "target_type" TEXT,
    "target_id" TEXT,
    "description" TEXT
);

-- Add any missing columns to an existing table
ALTER TABLE "alias" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "alias" ADD COLUMN IF NOT EXISTS "workspace_id" TEXT;
ALTER TABLE "alias" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "alias" ADD COLUMN IF NOT EXISTS "target_type" TEXT;
ALTER TABLE "alias" ADD COLUMN IF NOT EXISTS "target_id" TEXT;
ALTER TABLE "alias" ADD COLUMN IF NOT EXISTS "description" TEXT;
