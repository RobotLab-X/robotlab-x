-- managed
-- SQL migration for messages_google_chat_config table in packages
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "messages_google_chat_config" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT,
    "prefix" TEXT,
    "webhook_url" TEXT
);

-- Add any missing columns to an existing table
ALTER TABLE "messages_google_chat_config" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "messages_google_chat_config" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "messages_google_chat_config" ADD COLUMN IF NOT EXISTS "prefix" TEXT;
ALTER TABLE "messages_google_chat_config" ADD COLUMN IF NOT EXISTS "webhook_url" TEXT;
