-- managed
-- SQL migration for auth_oauth_callback_data table in packages
-- Creates the table if it doesn't exist, then ensures each column exists.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS "auth_oauth_callback_data" (
    "id" TEXT PRIMARY KEY,
    "access_token" TEXT,
    "access_type" TEXT,
    "additional_info" JSONB,
    "app_client_id" TEXT,
    "app_client_secret" TEXT,
    "app_name" TEXT,
    "auth_url" TEXT,
    "code" TEXT,
    "color" TEXT,
    "created_at" BIGINT,
    "email" TEXT,
    "error" TEXT,
    "error_description" TEXT,
    "expires_in" BIGINT,
    "id_token" TEXT,
    "id_token_payload" JSONB,
    "last_used" BIGINT,
    "profile" JSONB,
    "prompt" TEXT,
    "provider" TEXT,
    "raw_response" JSONB,
    "redirect_uri" TEXT,
    "refresh_expires_in" BIGINT,
    "refresh_token" TEXT,
    "scope" TEXT,
    "scopes" JSONB,
    "state" TEXT,
    "status" TEXT,
    "token_expires_at" BIGINT,
    "token_issued_at" BIGINT,
    "token_type" TEXT,
    "type" TEXT,
    "user_id" TEXT,
    "userinfo" JSONB
);

-- Add any missing columns to an existing table
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "access_token" TEXT;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "access_type" TEXT;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "additional_info" JSONB;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "app_client_id" TEXT;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "app_client_secret" TEXT;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "app_name" TEXT;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "auth_url" TEXT;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "code" TEXT;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "color" TEXT;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "created_at" BIGINT;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "error" TEXT;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "error_description" TEXT;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "expires_in" BIGINT;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "id_token" TEXT;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "id_token_payload" JSONB;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "last_used" BIGINT;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "profile" JSONB;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "prompt" TEXT;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "provider" TEXT;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "raw_response" JSONB;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "redirect_uri" TEXT;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "refresh_expires_in" BIGINT;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "refresh_token" TEXT;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "scope" TEXT;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "scopes" JSONB;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "state" TEXT;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "status" TEXT;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "token_expires_at" BIGINT;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "token_issued_at" BIGINT;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "token_type" TEXT;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "type" TEXT;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "user_id" TEXT;
ALTER TABLE "auth_oauth_callback_data" ADD COLUMN IF NOT EXISTS "userinfo" JSONB;
