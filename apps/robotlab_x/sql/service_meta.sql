-- managed
-- SQL migration for service_meta table in robotlab_x
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "service_meta" (
    "name" TEXT,
    "title" TEXT,
    "version" TEXT,
    "description" TEXT,
    "installed" BOOLEAN,
    "install_phase" TEXT,
    "load_error" TEXT,
    "install_error" TEXT,
    "installation_exception" TEXT,
    "repo_root" TEXT,
    "bundled" BOOLEAN,
    "status" TEXT,
    "os" TEXT,
    "is_dockerized" BOOLEAN,
    "is_cloud" BOOLEAN,
    "arch" TEXT,
    "language" TEXT,
    "dependency_manager" TEXT,
    "package_spec" TEXT,
    "entry_argv" TEXT,
    "entry_in_process" JSONB,
    "rating" DOUBLE PRECISION,
    "tags" TEXT,
    "implements" TEXT,
    "requires" TEXT,
    "author" TEXT,
    "homepage" TEXT,
    "license" TEXT,
    "wizard_steps" TEXT,
    "wizard_schema" JSONB,
    "install_steps" TEXT,
    "config_steps" TEXT,
    "config_schema" JSONB,
    "ui_schema" JSONB,
    "ui" JSONB
);

-- Add any missing columns to an existing table
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "version" TEXT;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "installed" BOOLEAN;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "install_phase" TEXT;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "load_error" TEXT;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "install_error" TEXT;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "installation_exception" TEXT;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "repo_root" TEXT;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "bundled" BOOLEAN;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "status" TEXT;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "os" TEXT;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "is_dockerized" BOOLEAN;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "is_cloud" BOOLEAN;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "arch" TEXT;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "language" TEXT;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "dependency_manager" TEXT;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "package_spec" TEXT;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "entry_argv" TEXT;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "entry_in_process" JSONB;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "rating" DOUBLE PRECISION;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "tags" TEXT;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "implements" TEXT;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "requires" TEXT;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "author" TEXT;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "homepage" TEXT;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "license" TEXT;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "wizard_steps" TEXT;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "wizard_schema" JSONB;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "install_steps" TEXT;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "config_steps" TEXT;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "config_schema" JSONB;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "ui_schema" JSONB;
ALTER TABLE "service_meta" ADD COLUMN IF NOT EXISTS "ui" JSONB;
