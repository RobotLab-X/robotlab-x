-- managed
-- SQL migration for topic table in robotlab_x
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "topic" (
    "id" TEXT PRIMARY KEY,
    "workspace_id" TEXT,
    "name" TEXT,
    "message_type" TEXT,
    "description" TEXT,
    "publisher_proxy_id" TEXT,
    "retained" BOOLEAN,
    "qos" JSONB
);

-- Add any missing columns to an existing table
ALTER TABLE "topic" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "topic" ADD COLUMN IF NOT EXISTS "workspace_id" TEXT;
ALTER TABLE "topic" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "topic" ADD COLUMN IF NOT EXISTS "message_type" TEXT;
ALTER TABLE "topic" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "topic" ADD COLUMN IF NOT EXISTS "publisher_proxy_id" TEXT;
ALTER TABLE "topic" ADD COLUMN IF NOT EXISTS "retained" BOOLEAN;
ALTER TABLE "topic" ADD COLUMN IF NOT EXISTS "qos" JSONB;
