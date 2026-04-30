ALTER TABLE "device_connection"
  ADD COLUMN "credential_kind" TEXT NOT NULL DEFAULT 'oauth_tokens',
  ADD COLUMN "provider_config_key" TEXT,
  ADD COLUMN "credential_metadata_json" JSONB,
  ADD COLUMN "setup_phase" TEXT,
  ADD COLUMN "setup_expires_at" TIMESTAMP(3);

ALTER TABLE "device_connection"
  ADD CONSTRAINT "device_connection_credential_kind_check"
  CHECK ("credential_kind" IN ('oauth_tokens', 'provider_config', 'none'));

ALTER TABLE "device_connection"
  ADD CONSTRAINT "device_connection_setup_phase_check"
  CHECK (
    "setup_phase" IS NULL
    OR "setup_phase" IN ('pending_link', 'link_returned', 'source_confirmed', 'failed')
  );

ALTER TABLE "device_connection"
  ADD CONSTRAINT "device_connection_credential_material_check"
  CHECK (
    (
      "credential_kind" = 'oauth_tokens'
      AND "provider_config_key" IS NULL
    )
    OR (
      "credential_kind" = 'provider_config'
      AND "provider_config_key" IS NOT NULL
      AND "access_token_encrypted" IS NULL
      AND "refresh_token_encrypted" IS NULL
      AND "access_token_expires_at" IS NULL
      AND "token_version" IS NULL
      AND "key_version" IS NULL
    )
    OR (
      "credential_kind" = 'none'
      AND "provider_config_key" IS NULL
      AND "access_token_encrypted" IS NULL
      AND "refresh_token_encrypted" IS NULL
      AND "access_token_expires_at" IS NULL
      AND "token_version" IS NULL
      AND "key_version" IS NULL
    )
  );

CREATE INDEX "device_connection_setup_phase_setup_expires_at_idx"
  ON "device_connection"("setup_phase", "setup_expires_at");
