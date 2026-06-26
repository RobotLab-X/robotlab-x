-- managed
-- SQL migration for messages_slack_config table in packages
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "messages_slack_config" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT,
    "prefix" TEXT,
    "channel" TEXT,
    "slack_token" TEXT
);

-- Add any missing columns to an existing table
ALTER TABLE "messages_slack_config" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "messages_slack_config" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "messages_slack_config" ADD COLUMN IF NOT EXISTS "prefix" TEXT;
ALTER TABLE "messages_slack_config" ADD COLUMN IF NOT EXISTS "channel" TEXT;
ALTER TABLE "messages_slack_config" ADD COLUMN IF NOT EXISTS "slack_token" TEXT;
