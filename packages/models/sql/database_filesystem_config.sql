-- managed
-- SQL migration for database_filesystem_config table in packages
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "database_filesystem_config" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT,
    "database_dir" TEXT
);

-- Add any missing columns to an existing table
ALTER TABLE "database_filesystem_config" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "database_filesystem_config" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "database_filesystem_config" ADD COLUMN IF NOT EXISTS "database_dir" TEXT;
