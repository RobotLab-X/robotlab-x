-- managed
-- SQL migration for service_request table in robotlab_x
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "service_request" (
    "id" TEXT PRIMARY KEY,
    "action" TEXT,
    "service_meta_id" TEXT,
    "proxy_name" TEXT,
    "workspace_id" TEXT,
    "service_proxy_id" TEXT,
    "config" JSONB,
    "status" TEXT,
    "result" TEXT,
    "created_at" TEXT,
    "completed_at" TEXT
);

-- Add any missing columns to an existing table
ALTER TABLE "service_request" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "service_request" ADD COLUMN IF NOT EXISTS "action" TEXT;
ALTER TABLE "service_request" ADD COLUMN IF NOT EXISTS "service_meta_id" TEXT;
ALTER TABLE "service_request" ADD COLUMN IF NOT EXISTS "proxy_name" TEXT;
ALTER TABLE "service_request" ADD COLUMN IF NOT EXISTS "workspace_id" TEXT;
ALTER TABLE "service_request" ADD COLUMN IF NOT EXISTS "service_proxy_id" TEXT;
ALTER TABLE "service_request" ADD COLUMN IF NOT EXISTS "config" JSONB;
ALTER TABLE "service_request" ADD COLUMN IF NOT EXISTS "status" TEXT;
ALTER TABLE "service_request" ADD COLUMN IF NOT EXISTS "result" TEXT;
ALTER TABLE "service_request" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "service_request" ADD COLUMN IF NOT EXISTS "completed_at" TEXT;
