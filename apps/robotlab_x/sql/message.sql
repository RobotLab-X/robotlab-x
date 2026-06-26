-- managed
-- SQL migration for message table in robotlab_x
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "message" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT,
    "type" TEXT,
    "method" TEXT,
    "data" JSONB,
    "reply_to" TEXT
);

-- Add any missing columns to an existing table
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "type" TEXT;
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "method" TEXT;
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "data" JSONB;
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "reply_to" TEXT;
