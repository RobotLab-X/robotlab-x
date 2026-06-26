-- managed
-- SQL migration for database_mongodb_config table in packages
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "database_mongodb_config" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT,
    "mongodb_replica_uri" TEXT,
    "mongodb_database_name" TEXT,
    "mongodb_max_pool_size" BIGINT,
    "mongodb_min_pool_size" BIGINT
);

-- Add any missing columns to an existing table
ALTER TABLE "database_mongodb_config" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "database_mongodb_config" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "database_mongodb_config" ADD COLUMN IF NOT EXISTS "mongodb_replica_uri" TEXT;
ALTER TABLE "database_mongodb_config" ADD COLUMN IF NOT EXISTS "mongodb_database_name" TEXT;
ALTER TABLE "database_mongodb_config" ADD COLUMN IF NOT EXISTS "mongodb_max_pool_size" BIGINT;
ALTER TABLE "database_mongodb_config" ADD COLUMN IF NOT EXISTS "mongodb_min_pool_size" BIGINT;
