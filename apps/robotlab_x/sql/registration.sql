-- managed
-- SQL migration for registration table in robotlab_x
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "registration" (
    "id" TEXT PRIMARY KEY,
    "user_id" TEXT,
    "email" TEXT,
    "fullname" TEXT,
    "password_hash" TEXT,
    "password" TEXT,
    "state" TEXT,
    "verification_token" TEXT,
    "created" BIGINT,
    "client_base_url" TEXT
);

-- Add any missing columns to an existing table
ALTER TABLE "registration" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "registration" ADD COLUMN IF NOT EXISTS "user_id" TEXT;
ALTER TABLE "registration" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "registration" ADD COLUMN IF NOT EXISTS "fullname" TEXT;
ALTER TABLE "registration" ADD COLUMN IF NOT EXISTS "password_hash" TEXT;
ALTER TABLE "registration" ADD COLUMN IF NOT EXISTS "password" TEXT;
ALTER TABLE "registration" ADD COLUMN IF NOT EXISTS "state" TEXT;
ALTER TABLE "registration" ADD COLUMN IF NOT EXISTS "verification_token" TEXT;
ALTER TABLE "registration" ADD COLUMN IF NOT EXISTS "created" BIGINT;
ALTER TABLE "registration" ADD COLUMN IF NOT EXISTS "client_base_url" TEXT;
