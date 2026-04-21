CREATE TABLE "hosted_vault_sync_session" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'local_to_hosted',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "pairing_code_hash" TEXT,
    "agent_token_hash" TEXT,
    "source_vault_id" TEXT,
    "source_vault_title" TEXT,
    "source_schema_version" TEXT,
    "local_manifest_hash" TEXT,
    "queued_ingress_event_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "uploaded_at" TIMESTAMP(3),
    "queued_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "hosted_vault_sync_session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hosted_vault_sync_payload" (
    "session_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "payload_schema" TEXT NOT NULL DEFAULT 'murph.hosted-vault-sync-payload.v1',
    "payload_encrypted" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_vault_sync_payload_pkey" PRIMARY KEY ("session_id")
);

CREATE UNIQUE INDEX "hosted_vault_sync_session_pairing_code_hash_key" ON "hosted_vault_sync_session"("pairing_code_hash");
CREATE UNIQUE INDEX "hosted_vault_sync_session_agent_token_hash_key" ON "hosted_vault_sync_session"("agent_token_hash");
CREATE UNIQUE INDEX "hosted_vault_sync_session_queued_ingress_event_id_key" ON "hosted_vault_sync_session"("queued_ingress_event_id");
CREATE INDEX "hosted_vault_sync_session_member_id_created_at_idx" ON "hosted_vault_sync_session"("member_id", "created_at");
CREATE INDEX "hosted_vault_sync_session_member_id_status_created_at_idx" ON "hosted_vault_sync_session"("member_id", "status", "created_at");
CREATE INDEX "hosted_vault_sync_session_expires_at_idx" ON "hosted_vault_sync_session"("expires_at");
CREATE INDEX "hosted_vault_sync_payload_member_id_created_at_idx" ON "hosted_vault_sync_payload"("member_id", "created_at");

ALTER TABLE "hosted_vault_sync_session" ADD CONSTRAINT "hosted_vault_sync_session_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hosted_vault_sync_payload" ADD CONSTRAINT "hosted_vault_sync_payload_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hosted_vault_sync_payload" ADD CONSTRAINT "hosted_vault_sync_payload_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "hosted_vault_sync_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
