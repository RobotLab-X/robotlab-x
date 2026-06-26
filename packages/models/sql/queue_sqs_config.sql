-- managed
-- SQL migration for queue_sqs_config table in packages
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "queue_sqs_config" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT,
    "queue_url" TEXT,
    "region_name" TEXT,
    "aws_access_key_id" TEXT,
    "aws_secret_access_key" TEXT
);

-- Add any missing columns to an existing table
ALTER TABLE "queue_sqs_config" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "queue_sqs_config" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "queue_sqs_config" ADD COLUMN IF NOT EXISTS "queue_url" TEXT;
ALTER TABLE "queue_sqs_config" ADD COLUMN IF NOT EXISTS "region_name" TEXT;
ALTER TABLE "queue_sqs_config" ADD COLUMN IF NOT EXISTS "aws_access_key_id" TEXT;
ALTER TABLE "queue_sqs_config" ADD COLUMN IF NOT EXISTS "aws_secret_access_key" TEXT;
