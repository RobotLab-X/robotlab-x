-- managed
-- SQL migration for database_lowdb_config table in packages
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "database_lowdb_config" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT,
    "data_dir" TEXT
);

-- Add any missing columns to an existing table
ALTER TABLE "database_lowdb_config" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "database_lowdb_config" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "database_lowdb_config" ADD COLUMN IF NOT EXISTS "data_dir" TEXT;
