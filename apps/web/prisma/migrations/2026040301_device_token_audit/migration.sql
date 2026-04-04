CREATE TABLE IF NOT EXISTS "device_token_audit" (
  "id" SERIAL NOT NULL,
  "user_id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "session_id" TEXT,
  "token_version" INTEGER NOT NULL,
  "key_version" TEXT NOT NULL,
  "metadata_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "device_token_audit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "device_token_audit_user_id_id_idx"
  ON "device_token_audit"("user_id", "id");

CREATE INDEX IF NOT EXISTS "device_token_audit_connection_id_created_at_idx"
  ON "device_token_audit"("connection_id", "created_at");

CREATE INDEX IF NOT EXISTS "device_token_audit_created_at_idx"
  ON "device_token_audit"("created_at");

DO $$
BEGIN
  ALTER TABLE "device_token_audit"
    ADD CONSTRAINT "device_token_audit_connection_id_fkey"
    FOREIGN KEY ("connection_id") REFERENCES "device_connection"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
