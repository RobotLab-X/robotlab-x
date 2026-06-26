-- managed
-- SQL migration for subscription table in robotlab_x
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "subscription" (
    "id" TEXT PRIMARY KEY,
    "workspace_id" TEXT,
    "topic_id" TEXT,
    "subscriber_proxy_id" TEXT,
    "method" TEXT,
    "filter" JSONB
);

-- Add any missing columns to an existing table
ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "workspace_id" TEXT;
ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "topic_id" TEXT;
ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "subscriber_proxy_id" TEXT;
ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "method" TEXT;
ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "filter" JSONB;
