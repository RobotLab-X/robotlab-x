-- managed
-- SQL migration for messages_local_config table in packages
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "messages_local_config" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT,
    "prefix" TEXT,
    "logger_name" TEXT,
    "use_print" BOOLEAN,
    "buffer_messages" BOOLEAN
);

-- Add any missing columns to an existing table
ALTER TABLE "messages_local_config" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "messages_local_config" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "messages_local_config" ADD COLUMN IF NOT EXISTS "prefix" TEXT;
ALTER TABLE "messages_local_config" ADD COLUMN IF NOT EXISTS "logger_name" TEXT;
ALTER TABLE "messages_local_config" ADD COLUMN IF NOT EXISTS "use_print" BOOLEAN;
ALTER TABLE "messages_local_config" ADD COLUMN IF NOT EXISTS "buffer_messages" BOOLEAN;
