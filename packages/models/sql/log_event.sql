-- managed
-- SQL migration for log_event table in packages
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "log_event" (
    "id" TEXT PRIMARY KEY,
    "ts" TEXT,
    "service" TEXT,
    "level" TEXT,
    "logger" TEXT,
    "message" TEXT,
    "tenant_id" TEXT,
    "user_id" TEXT,
    "request_id" TEXT,
    "method" TEXT,
    "path" TEXT,
    "status_code" BIGINT,
    "context" JSONB,
    "traceback" TEXT
);

-- Add any missing columns to an existing table
ALTER TABLE "log_event" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "log_event" ADD COLUMN IF NOT EXISTS "ts" TEXT;
ALTER TABLE "log_event" ADD COLUMN IF NOT EXISTS "service" TEXT;
ALTER TABLE "log_event" ADD COLUMN IF NOT EXISTS "level" TEXT;
ALTER TABLE "log_event" ADD COLUMN IF NOT EXISTS "logger" TEXT;
ALTER TABLE "log_event" ADD COLUMN IF NOT EXISTS "message" TEXT;
ALTER TABLE "log_event" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
ALTER TABLE "log_event" ADD COLUMN IF NOT EXISTS "user_id" TEXT;
ALTER TABLE "log_event" ADD COLUMN IF NOT EXISTS "request_id" TEXT;
ALTER TABLE "log_event" ADD COLUMN IF NOT EXISTS "method" TEXT;
ALTER TABLE "log_event" ADD COLUMN IF NOT EXISTS "path" TEXT;
ALTER TABLE "log_event" ADD COLUMN IF NOT EXISTS "status_code" BIGINT;
ALTER TABLE "log_event" ADD COLUMN IF NOT EXISTS "context" JSONB;
ALTER TABLE "log_event" ADD COLUMN IF NOT EXISTS "traceback" TEXT;
