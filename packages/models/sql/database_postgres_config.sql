-- managed
-- SQL migration for database_postgres_config table in packages
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "database_postgres_config" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT,
    "host" TEXT,
    "port" BIGINT,
    "user" TEXT,
    "password" TEXT,
    "database" TEXT,
    "sslmode" TEXT,
    "ensure_table" BOOLEAN,
    "min_connections" BIGINT,
    "max_connections" BIGINT
);

-- Add any missing columns to an existing table
ALTER TABLE "database_postgres_config" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "database_postgres_config" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "database_postgres_config" ADD COLUMN IF NOT EXISTS "host" TEXT;
ALTER TABLE "database_postgres_config" ADD COLUMN IF NOT EXISTS "port" BIGINT;
ALTER TABLE "database_postgres_config" ADD COLUMN IF NOT EXISTS "user" TEXT;
ALTER TABLE "database_postgres_config" ADD COLUMN IF NOT EXISTS "password" TEXT;
ALTER TABLE "database_postgres_config" ADD COLUMN IF NOT EXISTS "database" TEXT;
ALTER TABLE "database_postgres_config" ADD COLUMN IF NOT EXISTS "sslmode" TEXT;
ALTER TABLE "database_postgres_config" ADD COLUMN IF NOT EXISTS "ensure_table" BOOLEAN;
ALTER TABLE "database_postgres_config" ADD COLUMN IF NOT EXISTS "min_connections" BIGINT;
ALTER TABLE "database_postgres_config" ADD COLUMN IF NOT EXISTS "max_connections" BIGINT;
