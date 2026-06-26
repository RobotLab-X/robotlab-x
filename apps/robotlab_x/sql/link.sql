-- managed
-- SQL migration for link table in robotlab_x
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "link" (
    "id" TEXT PRIMARY KEY,
    "source_proxy_id" TEXT,
    "source_topic" TEXT,
    "target_proxy_id" TEXT,
    "target_sink" TEXT,
    "kind" TEXT,
    "origin" TEXT
);

-- Add any missing columns to an existing table
ALTER TABLE "link" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "link" ADD COLUMN IF NOT EXISTS "source_proxy_id" TEXT;
ALTER TABLE "link" ADD COLUMN IF NOT EXISTS "source_topic" TEXT;
ALTER TABLE "link" ADD COLUMN IF NOT EXISTS "target_proxy_id" TEXT;
ALTER TABLE "link" ADD COLUMN IF NOT EXISTS "target_sink" TEXT;
ALTER TABLE "link" ADD COLUMN IF NOT EXISTS "kind" TEXT;
ALTER TABLE "link" ADD COLUMN IF NOT EXISTS "origin" TEXT;
