-- managed
-- SQL migration for script table in robotlab_x
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "script" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT,
    "language" TEXT,
    "body" TEXT,
    "created_at" TEXT,
    "updated_at" TEXT
);

-- Add any missing columns to an existing table
ALTER TABLE "script" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "script" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "script" ADD COLUMN IF NOT EXISTS "language" TEXT;
ALTER TABLE "script" ADD COLUMN IF NOT EXISTS "body" TEXT;
ALTER TABLE "script" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "script" ADD COLUMN IF NOT EXISTS "updated_at" TEXT;
