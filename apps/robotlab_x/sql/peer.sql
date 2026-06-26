-- managed
-- SQL migration for peer table in robotlab_x
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "peer" (
    "id" TEXT PRIMARY KEY,
    "key" TEXT,
    "url" TEXT,
    "remote_id" TEXT,
    "state" TEXT,
    "upstream_subs" JSONB,
    "collision" TEXT
);

-- Add any missing columns to an existing table
ALTER TABLE "peer" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "peer" ADD COLUMN IF NOT EXISTS "key" TEXT;
ALTER TABLE "peer" ADD COLUMN IF NOT EXISTS "url" TEXT;
ALTER TABLE "peer" ADD COLUMN IF NOT EXISTS "remote_id" TEXT;
ALTER TABLE "peer" ADD COLUMN IF NOT EXISTS "state" TEXT;
ALTER TABLE "peer" ADD COLUMN IF NOT EXISTS "upstream_subs" JSONB;
ALTER TABLE "peer" ADD COLUMN IF NOT EXISTS "collision" TEXT;
