-- managed
-- SQL migration for monitor_data table in packages
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "monitor_data" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT,
    "started" BIGINT,
    "drive_space_total_gb" BIGINT,
    "drive_free_space_gb" BIGINT,
    "memory_total_gb" BIGINT,
    "memory_available_gb" BIGINT,
    "load_average" DOUBLE PRECISION,
    "alert" TEXT
);

-- Add any missing columns to an existing table
ALTER TABLE "monitor_data" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "monitor_data" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "monitor_data" ADD COLUMN IF NOT EXISTS "started" BIGINT;
ALTER TABLE "monitor_data" ADD COLUMN IF NOT EXISTS "drive_space_total_gb" BIGINT;
ALTER TABLE "monitor_data" ADD COLUMN IF NOT EXISTS "drive_free_space_gb" BIGINT;
ALTER TABLE "monitor_data" ADD COLUMN IF NOT EXISTS "memory_total_gb" BIGINT;
ALTER TABLE "monitor_data" ADD COLUMN IF NOT EXISTS "memory_available_gb" BIGINT;
ALTER TABLE "monitor_data" ADD COLUMN IF NOT EXISTS "load_average" DOUBLE PRECISION;
ALTER TABLE "monitor_data" ADD COLUMN IF NOT EXISTS "alert" TEXT;
