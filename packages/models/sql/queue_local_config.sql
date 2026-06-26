-- managed
-- SQL migration for queue_local_config table in packages
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "queue_local_config" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT,
    "max_workers" BIGINT,
    "max_queue_size" BIGINT
);

-- Add any missing columns to an existing table
ALTER TABLE "queue_local_config" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "queue_local_config" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "queue_local_config" ADD COLUMN IF NOT EXISTS "max_workers" BIGINT;
ALTER TABLE "queue_local_config" ADD COLUMN IF NOT EXISTS "max_queue_size" BIGINT;
