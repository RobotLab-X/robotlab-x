-- managed
-- SQL migration for database_s3_config table in packages
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "database_s3_config" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT,
    "bucket_name" TEXT,
    "region_name" TEXT,
    "aws_access_key_id" TEXT,
    "aws_secret_access_key" TEXT,
    "table_prefix" TEXT
);

-- Add any missing columns to an existing table
ALTER TABLE "database_s3_config" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "database_s3_config" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "database_s3_config" ADD COLUMN IF NOT EXISTS "bucket_name" TEXT;
ALTER TABLE "database_s3_config" ADD COLUMN IF NOT EXISTS "region_name" TEXT;
ALTER TABLE "database_s3_config" ADD COLUMN IF NOT EXISTS "aws_access_key_id" TEXT;
ALTER TABLE "database_s3_config" ADD COLUMN IF NOT EXISTS "aws_secret_access_key" TEXT;
ALTER TABLE "database_s3_config" ADD COLUMN IF NOT EXISTS "table_prefix" TEXT;
