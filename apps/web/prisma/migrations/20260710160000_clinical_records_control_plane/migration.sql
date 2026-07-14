CREATE TABLE "clinical_record_connect_intent" (
    "claim_hash" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "provider_directory_entry_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "clinical_record_connect_intent_pkey" PRIMARY KEY ("claim_hash")
);

CREATE TABLE "clinical_record_oauth_session" (
    "state_hash" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "web_session_id" TEXT NOT NULL,
    "connect_intent_claim_hash" TEXT NOT NULL,
    "provider_directory_entry_id" TEXT NOT NULL,
    "fhir_base_url" TEXT NOT NULL,
    "token_endpoint" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "requested_scopes_json" JSONB NOT NULL,
    "code_verifier_encrypted" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),

    CONSTRAINT "clinical_record_oauth_session_pkey" PRIMARY KEY ("state_hash")
);

CREATE TABLE "clinical_record_connection" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "provider_directory_entry_id" TEXT NOT NULL,
    "source_system" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "fhir_base_url" TEXT NOT NULL,
    "fhir_base_hash" TEXT NOT NULL,
    "token_endpoint" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "patient_id_encrypted" TEXT,
    "access_token_encrypted" TEXT,
    "refresh_token_encrypted" TEXT,
    "access_token_expires_at" TIMESTAMP(3),
    "requested_scopes_json" JSONB NOT NULL,
    "granted_scopes_json" JSONB NOT NULL,
    "token_version" INTEGER NOT NULL DEFAULT 1,
    "retrieval_generation" INTEGER NOT NULL DEFAULT 0,
    "connected_at" TIMESTAMP(3) NOT NULL,
    "disconnected_at" TIMESTAMP(3),
    "last_sync_completed_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinical_record_connection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "clinical_record_retrieval_run" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "resource_types_json" JSONB NOT NULL,
    "granted_scopes_json" JSONB NOT NULL,
    "page_count" INTEGER NOT NULL DEFAULT 0,
    "fetched_bytes" INTEGER NOT NULL DEFAULT 0,
    "egress_bytes" INTEGER NOT NULL DEFAULT 0,
    "provider_request_count" INTEGER NOT NULL DEFAULT 0,
    "imported_count" INTEGER NOT NULL DEFAULT 0,
    "review_count" INTEGER NOT NULL DEFAULT 0,
    "last_error_code" TEXT,
    "outcome_counts_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "clinical_record_retrieval_run_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "clinical_record_retrieval_request" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "reserved_bytes" INTEGER NOT NULL DEFAULT 0,
    "response_bytes" INTEGER,
    "claim_version" INTEGER NOT NULL DEFAULT 1,
    "claimed_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinical_record_retrieval_request_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "clinical_record_connect_intent_expires_at_idx" ON "clinical_record_connect_intent"("expires_at");
CREATE INDEX "clinical_record_connect_intent_member_id_expires_at_idx" ON "clinical_record_connect_intent"("member_id", "expires_at");
CREATE INDEX "clinical_record_connect_intent_started_at_idx" ON "clinical_record_connect_intent"("started_at");
CREATE UNIQUE INDEX "clinical_record_connect_intent_member_id_live_key" ON "clinical_record_connect_intent"("member_id") WHERE "completed_at" IS NULL;
CREATE INDEX "clinical_record_oauth_session_expires_at_idx" ON "clinical_record_oauth_session"("expires_at");
CREATE INDEX "clinical_record_oauth_session_member_id_provider_directory_entry_id_idx" ON "clinical_record_oauth_session"("member_id", "provider_directory_entry_id");
CREATE INDEX "clinical_record_oauth_session_connect_intent_claim_hash_idx" ON "clinical_record_oauth_session"("connect_intent_claim_hash");
CREATE UNIQUE INDEX "clinical_record_connection_member_id_provider_directory_entry_id_key" ON "clinical_record_connection"("member_id", "provider_directory_entry_id");
CREATE INDEX "clinical_record_connection_member_id_status_updated_at_idx" ON "clinical_record_connection"("member_id", "status", "updated_at");
CREATE INDEX "clinical_record_connection_fhir_base_hash_idx" ON "clinical_record_connection"("fhir_base_hash");
CREATE UNIQUE INDEX "clinical_record_retrieval_run_connection_id_generation_key" ON "clinical_record_retrieval_run"("connection_id", "generation");
CREATE INDEX "clinical_record_retrieval_run_member_id_status_created_at_idx" ON "clinical_record_retrieval_run"("member_id", "status", "created_at");
CREATE INDEX "clinical_record_retrieval_run_connection_id_created_at_idx" ON "clinical_record_retrieval_run"("connection_id", "created_at");
CREATE UNIQUE INDEX "clinical_record_retrieval_request_run_id_request_fingerprint_key" ON "clinical_record_retrieval_request"("run_id", "request_fingerprint");
CREATE INDEX "clinical_record_retrieval_request_member_id_created_at_idx" ON "clinical_record_retrieval_request"("member_id", "created_at");
CREATE INDEX "clinical_record_retrieval_request_connection_id_generation_idx" ON "clinical_record_retrieval_request"("connection_id", "generation");

ALTER TABLE "clinical_record_connect_intent" ADD CONSTRAINT "clinical_record_connect_intent_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_record_oauth_session" ADD CONSTRAINT "clinical_record_oauth_session_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_record_connection" ADD CONSTRAINT "clinical_record_connection_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_record_retrieval_run" ADD CONSTRAINT "clinical_record_retrieval_run_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "clinical_record_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_record_retrieval_run" ADD CONSTRAINT "clinical_record_retrieval_run_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_record_retrieval_request" ADD CONSTRAINT "clinical_record_retrieval_request_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_record_retrieval_request" ADD CONSTRAINT "clinical_record_retrieval_request_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "clinical_record_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_record_retrieval_request" ADD CONSTRAINT "clinical_record_retrieval_request_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "clinical_record_retrieval_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
