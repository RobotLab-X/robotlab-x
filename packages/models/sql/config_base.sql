-- managed
-- SQL migration for config_base table in packages
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "config_base" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT,
    "description" TEXT,
    "version" TEXT,
    "created" BIGINT,
    "modified" BIGINT,
    "debug" BOOLEAN,
    "log_level" TEXT,
    "log_format" TEXT,
    "log_uv_access_enabled" BOOLEAN,
    "port" BIGINT,
    "cors_origin" TEXT,
    "num_pipelines" BIGINT,
    "auth_type" TEXT,
    "jwt_secret" TEXT,
    "auth_session_ttl_seconds" BIGINT,
    "auth_session_idle_timeout_seconds" BIGINT,
    "jwt_access_token_ttl_minutes" BIGINT,
    "ssl_enabled" BOOLEAN,
    "resource_monitor_enabled" BOOLEAN,
    "app_server_enabled" BOOLEAN
);

-- Add any missing columns to an existing table
ALTER TABLE "config_base" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "config_base" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "config_base" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "config_base" ADD COLUMN IF NOT EXISTS "version" TEXT;
ALTER TABLE "config_base" ADD COLUMN IF NOT EXISTS "created" BIGINT;
ALTER TABLE "config_base" ADD COLUMN IF NOT EXISTS "modified" BIGINT;
ALTER TABLE "config_base" ADD COLUMN IF NOT EXISTS "debug" BOOLEAN;
ALTER TABLE "config_base" ADD COLUMN IF NOT EXISTS "log_level" TEXT;
ALTER TABLE "config_base" ADD COLUMN IF NOT EXISTS "log_format" TEXT;
ALTER TABLE "config_base" ADD COLUMN IF NOT EXISTS "log_uv_access_enabled" BOOLEAN;
ALTER TABLE "config_base" ADD COLUMN IF NOT EXISTS "port" BIGINT;
ALTER TABLE "config_base" ADD COLUMN IF NOT EXISTS "cors_origin" TEXT;
ALTER TABLE "config_base" ADD COLUMN IF NOT EXISTS "num_pipelines" BIGINT;
ALTER TABLE "config_base" ADD COLUMN IF NOT EXISTS "auth_type" TEXT;
ALTER TABLE "config_base" ADD COLUMN IF NOT EXISTS "jwt_secret" TEXT;
ALTER TABLE "config_base" ADD COLUMN IF NOT EXISTS "auth_session_ttl_seconds" BIGINT;
ALTER TABLE "config_base" ADD COLUMN IF NOT EXISTS "auth_session_idle_timeout_seconds" BIGINT;
ALTER TABLE "config_base" ADD COLUMN IF NOT EXISTS "jwt_access_token_ttl_minutes" BIGINT;
ALTER TABLE "config_base" ADD COLUMN IF NOT EXISTS "ssl_enabled" BOOLEAN;
ALTER TABLE "config_base" ADD COLUMN IF NOT EXISTS "resource_monitor_enabled" BOOLEAN;
ALTER TABLE "config_base" ADD COLUMN IF NOT EXISTS "app_server_enabled" BOOLEAN;
