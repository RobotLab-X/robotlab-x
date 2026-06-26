-- managed
-- SQL migration for workspace table in robotlab_x
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "workspace" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT,
    "description" TEXT,
    "status" TEXT,
    "kind" TEXT,
    "service_proxy_ids" TEXT,
    "node_positions" JSONB,
    "node_view_types" JSONB,
    "edges" TEXT,
    "dashboard" JSONB,
    "viewport" JSONB,
    "activated_at" TEXT,
    "created_at" TEXT,
    "updated_at" TEXT
);

-- Add any missing columns to an existing table
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "status" TEXT;
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "kind" TEXT;
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "service_proxy_ids" TEXT;
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "node_positions" JSONB;
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "node_view_types" JSONB;
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "edges" TEXT;
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "dashboard" JSONB;
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "viewport" JSONB;
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "activated_at" TEXT;
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "updated_at" TEXT;
