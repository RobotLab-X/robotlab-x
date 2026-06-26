-- managed
-- SQL migration for service_proxy table in robotlab_x
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "service_proxy" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT,
    "service_meta_id" TEXT,
    "status" TEXT,
    "configured" BOOLEAN,
    "pid" BIGINT,
    "host" TEXT,
    "port" BIGINT,
    "created_at" TEXT,
    "started_at" TEXT,
    "stopped_at" TEXT,
    "error" TEXT,
    "service_config" JSONB
);

-- Add any missing columns to an existing table
ALTER TABLE "service_proxy" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "service_proxy" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "service_proxy" ADD COLUMN IF NOT EXISTS "service_meta_id" TEXT;
ALTER TABLE "service_proxy" ADD COLUMN IF NOT EXISTS "status" TEXT;
ALTER TABLE "service_proxy" ADD COLUMN IF NOT EXISTS "configured" BOOLEAN;
ALTER TABLE "service_proxy" ADD COLUMN IF NOT EXISTS "pid" BIGINT;
ALTER TABLE "service_proxy" ADD COLUMN IF NOT EXISTS "host" TEXT;
ALTER TABLE "service_proxy" ADD COLUMN IF NOT EXISTS "port" BIGINT;
ALTER TABLE "service_proxy" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "service_proxy" ADD COLUMN IF NOT EXISTS "started_at" TEXT;
ALTER TABLE "service_proxy" ADD COLUMN IF NOT EXISTS "stopped_at" TEXT;
ALTER TABLE "service_proxy" ADD COLUMN IF NOT EXISTS "error" TEXT;
ALTER TABLE "service_proxy" ADD COLUMN IF NOT EXISTS "service_config" JSONB;
