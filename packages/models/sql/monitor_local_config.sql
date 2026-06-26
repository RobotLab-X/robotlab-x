-- managed
-- SQL migration for monitor_local_config table in packages
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "monitor_local_config" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT,
    "check_disk_space_used_threshold_percent" BIGINT,
    "check_memory_used_threshold_percent" BIGINT,
    "check_load_average_threshold_percent" DOUBLE PRECISION,
    "interval_seconds" BIGINT,
    "message_id" TEXT,
    "alert_on_threshold_crossed" BOOLEAN
);

-- Add any missing columns to an existing table
ALTER TABLE "monitor_local_config" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "monitor_local_config" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "monitor_local_config" ADD COLUMN IF NOT EXISTS "check_disk_space_used_threshold_percent" BIGINT;
ALTER TABLE "monitor_local_config" ADD COLUMN IF NOT EXISTS "check_memory_used_threshold_percent" BIGINT;
ALTER TABLE "monitor_local_config" ADD COLUMN IF NOT EXISTS "check_load_average_threshold_percent" DOUBLE PRECISION;
ALTER TABLE "monitor_local_config" ADD COLUMN IF NOT EXISTS "interval_seconds" BIGINT;
ALTER TABLE "monitor_local_config" ADD COLUMN IF NOT EXISTS "message_id" TEXT;
ALTER TABLE "monitor_local_config" ADD COLUMN IF NOT EXISTS "alert_on_threshold_crossed" BOOLEAN;
