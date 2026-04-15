-- AlterTable
ALTER TABLE "device_connection"
ADD COLUMN "display_name" TEXT,
ADD COLUMN "scopes_json" JSONB,
ADD COLUMN "metadata_json" JSONB,
ADD COLUMN "external_account_id_encrypted" TEXT,
ADD COLUMN "access_token_encrypted" TEXT,
ADD COLUMN "refresh_token_encrypted" TEXT,
ADD COLUMN "access_token_expires_at" TIMESTAMP(3),
ADD COLUMN "token_version" INTEGER,
ADD COLUMN "key_version" TEXT;
