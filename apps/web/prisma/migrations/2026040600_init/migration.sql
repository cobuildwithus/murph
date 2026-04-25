-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "HostedBillingStatus" AS ENUM ('not_started', 'active', 'incomplete', 'past_due', 'canceled', 'unpaid', 'paused');

-- CreateEnum
CREATE TYPE "HostedStripeEventStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'poisoned');

-- CreateEnum
CREATE TYPE "HostedIngressBehavior" AS ENUM ('ordered', 'coalescing');

-- CreateTable
CREATE TABLE "device_connection" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_blind_index" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "display_name" TEXT,
    "scopes_json" JSONB,
    "metadata_json" JSONB,
    "external_account_id_encrypted" TEXT,
    "access_token_encrypted" TEXT,
    "refresh_token_encrypted" TEXT,
    "access_token_expires_at" TIMESTAMP(3),
    "token_version" INTEGER,
    "key_version" TEXT,
    "connected_at" TIMESTAMP(3) NOT NULL,
    "last_webhook_at" TIMESTAMP(3),
    "last_sync_started_at" TIMESTAMP(3),
    "last_sync_completed_at" TIMESTAMP(3),
    "last_sync_error_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "next_reconcile_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_token_audit" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "session_id" TEXT,
    "token_version" INTEGER NOT NULL,
    "key_version" TEXT NOT NULL,
    "expected_token_version" INTEGER,
    "force_refresh" BOOLEAN,
    "refresh_outcome" TEXT,
    "token_version_changed" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_token_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_oauth_session" (
    "state" TEXT NOT NULL,
    "user_id" TEXT,
    "provider" TEXT NOT NULL,
    "return_to" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_oauth_session_pkey" PRIMARY KEY ("state")
);

-- CreateTable
CREATE TABLE "device_webhook_trace" (
    "provider" TEXT NOT NULL,
    "trace_id" TEXT NOT NULL,
    "provider_account_blind_index" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processed',
    "processing_expires_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_webhook_trace_pkey" PRIMARY KEY ("provider","trace_id")
);

-- CreateTable
CREATE TABLE "device_sync_signal" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "connection_id" TEXT,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3),
    "trace_id" TEXT,
    "event_type" TEXT,
    "resource_category" TEXT,
    "reason" TEXT,
    "next_reconcile_at" TIMESTAMP(3),
    "revoke_warning_code" TEXT,
    "revoke_warning_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_sync_signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_agent_session" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "label" TEXT,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoke_reason" TEXT,
    "replaced_by_session_id" TEXT,

    CONSTRAINT "device_agent_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_browser_assertion_nonce" (
    "nonce_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_browser_assertion_nonce_pkey" PRIMARY KEY ("nonce_hash")
);

-- CreateTable
CREATE TABLE "hosted_web_internal_request_nonce" (
    "nonce_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "search" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_web_internal_request_nonce_pkey" PRIMARY KEY ("nonce_hash")
);

-- CreateTable
CREATE TABLE "hosted_member" (
    "id" TEXT NOT NULL,
    "billing_status" "HostedBillingStatus" NOT NULL DEFAULT 'not_started',
    "suspended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hosted_member_identity" (
    "member_id" TEXT NOT NULL,
    "masked_phone_number_hint" TEXT,
    "phone_lookup_key" TEXT,
    "phone_number_encrypted" TEXT,
    "phone_number_verified_at" TIMESTAMP(3),
    "privy_user_lookup_key" TEXT,
    "privy_user_id_encrypted" TEXT,
    "wallet_address_lookup_key" TEXT,
    "wallet_address_encrypted" TEXT,
    "wallet_chain_type" TEXT,
    "wallet_provider" TEXT,
    "wallet_created_at" TIMESTAMP(3),
    "signup_phone_number_encrypted" TEXT,
    "signup_phone_code_sent_at" TIMESTAMP(3),
    "signup_phone_code_send_attempt_id" TEXT,
    "signup_phone_code_send_attempt_started_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "hosted_member_routing" (
    "member_id" TEXT NOT NULL,
    "linq_chat_lookup_key" TEXT,
    "linq_chat_id_encrypted" TEXT,
    "linq_recipient_phone_lookup_key" TEXT,
    "linq_recipient_phone_encrypted" TEXT,
    "pending_linq_chat_lookup_key" TEXT,
    "pending_linq_chat_id_encrypted" TEXT,
    "pending_linq_recipient_phone_lookup_key" TEXT,
    "pending_linq_recipient_phone_encrypted" TEXT,
    "reply_alias_lookup_key" TEXT,
    "telegram_user_lookup_key" TEXT,
    "telegram_user_id_encrypted" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "hosted_member_billing_ref" (
    "member_id" TEXT NOT NULL,
    "stripe_customer_lookup_key" TEXT,
    "stripe_customer_id_encrypted" TEXT,
    "stripe_subscription_lookup_key" TEXT,
    "stripe_subscription_id_encrypted" TEXT,
    "last_stripe_event_created_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "hosted_member_email_authorization" (
    "member_id" TEXT NOT NULL,
    "verified_email_lookup_key" TEXT,
    "verified_email_address_encrypted" TEXT,
    "verified_email_verified_at" TIMESTAMP(3),
    "direct_public_sender_lookup_key" TEXT,
    "direct_public_sender_address_encrypted" TEXT,
    "direct_public_sender_authorized_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "hosted_execution_cursor" (
    "user_id" TEXT NOT NULL,
    "next_seq" BIGINT NOT NULL DEFAULT 1,
    "committed_seq" BIGINT NOT NULL DEFAULT 0,
    "next_runtime_wake_at" TIMESTAMP(3),
    "next_runtime_wake_reason" TEXT,
    "snapshot_ref" JSONB,
    "browser_vault_replica_ref" JSONB,
    "version" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_execution_cursor_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "hosted_ingress_event" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "run_id" TEXT,
    "seq" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "behavior" "HostedIngressBehavior" NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "dedupe_key" TEXT,
    "coalescing_key" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "payload_schema" TEXT NOT NULL,
    "payload_inline_ciphertext" TEXT,
    "payload_ref" TEXT,
    "payload_bytes" INTEGER,
    "completed_at" TIMESTAMP(3),
    "quarantined_at" TIMESTAMP(3),
    "quarantine_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_ingress_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hosted_run" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "executor_kind" TEXT NOT NULL DEFAULT 'cloudflare-container',
    "executor_code_digest" TEXT,
    "attestation_ref" TEXT,
    "signed_result_ref" TEXT,
    "status" TEXT NOT NULL,
    "trigger_kind" TEXT NOT NULL,
    "run_token_hash" TEXT NOT NULL,
    "input_committed_seq" BIGINT NOT NULL,
    "output_committed_seq" BIGINT,
    "input_cursor_version" BIGINT NOT NULL,
    "output_cursor_version" BIGINT,
    "input_snapshot_ref" JSONB,
    "prepared_snapshot_ref" JSONB,
    "final_snapshot_ref" JSONB,
    "next_runtime_wake_at" TIMESTAMP(3),
    "next_runtime_wake_reason" TEXT,
    "event_count" INTEGER NOT NULL DEFAULT 0,
    "event_kinds_json" JSONB NOT NULL,
    "event_seqs_json" JSONB NOT NULL,
    "ingress_event_ids_json" JSONB NOT NULL,
    "redacted_summary_json" JSONB,
    "error_code" TEXT,
    "error_class" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "acquired_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "prepared_at" TIMESTAMP(3),
    "committed_at" TIMESTAMP(3),
    "finalized_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hosted_run_log" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "level" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "redacted_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hosted_run_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hosted_ingress_event_alias" (
    "event_id" TEXT NOT NULL,
    "ingress_event_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "replaced_by_event_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_ingress_event_alias_pkey" PRIMARY KEY ("user_id","event_id")
);

-- CreateTable
CREATE TABLE "hosted_ingress_payload" (
    "ingress_event_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "payload_ciphertext" TEXT NOT NULL,
    "payload_schema" TEXT NOT NULL,
    "payload_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_ingress_payload_pkey" PRIMARY KEY ("ingress_event_id")
);

-- CreateTable
CREATE TABLE "hosted_invite" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "invite_code" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'linq',
    "sent_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hosted_stripe_event" (
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "stripe_created_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "status" "HostedStripeEventStatus" NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claim_expires_at" TIMESTAMP(3),
    "processed_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_stripe_event_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "hosted_share_link" (
    "id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "sender_member_id" TEXT NOT NULL,
    "preview_json" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "accepted_by_member_id" TEXT,
    "consumed_at" TIMESTAMP(3),
    "consumed_by_member_id" TEXT,
    "last_event_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_share_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hosted_share_payload" (
    "share_id" TEXT NOT NULL,
    "payload_schema" TEXT NOT NULL DEFAULT 'murph.hosted-share-payload.v1',
    "payload_encrypted" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "hosted_vault_sync_payload" (
    "session_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "payload_schema" TEXT NOT NULL DEFAULT 'murph.hosted-vault-sync-payload.v1',
    "payload_encrypted" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_vault_sync_payload_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable
CREATE TABLE "hosted_ai_usage" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "turn_id" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "provider" TEXT NOT NULL,
    "route_id" TEXT,
    "requested_model" TEXT,
    "served_model" TEXT,
    "provider_name" TEXT,
    "base_url" TEXT,
    "api_key_env" TEXT,
    "credential_source" TEXT,
    "feature_key" TEXT,
    "surface" TEXT,
    "trigger_kind" TEXT,
    "reporting_user_id" TEXT,
    "gateway_tags_json" JSONB,
    "stripe_meter_source" TEXT NOT NULL DEFAULT 'murph',
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "reasoning_tokens" INTEGER,
    "cached_input_tokens" INTEGER,
    "cache_write_tokens" INTEGER,
    "total_tokens" INTEGER,
    "stripe_meter_status" TEXT NOT NULL DEFAULT 'pending',
    "stripe_meter_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "stripe_meter_last_attempted_at" TIMESTAMP(3),
    "stripe_meter_next_attempt_at" TIMESTAMP(3),
    "stripe_metered_at" TIMESTAMP(3),
    "stripe_meter_identifier" TEXT,
    "stripe_meter_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hosted_assistant_runtime_issue" (
    "id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "environment" TEXT NOT NULL,
    "surface" TEXT,
    "phase" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "issue_kind" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "operation" TEXT,
    "error_code" TEXT,
    "summary" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "details_json" JSONB NOT NULL,
    "release_sha" TEXT,
    "runtime_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_assistant_runtime_issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hosted_linq_daily_state" (
    "member_id" TEXT NOT NULL,
    "day_utc" TIMESTAMP(3) NOT NULL,
    "inbound_count" INTEGER NOT NULL DEFAULT 0,
    "outbound_count" INTEGER NOT NULL DEFAULT 0,
    "onboarding_link_sent_at" TIMESTAMP(3),
    "quota_reply_sent_at" TIMESTAMP(3),
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_linq_daily_state_pkey" PRIMARY KEY ("member_id","day_utc")
);

-- CreateTable
CREATE TABLE "linq_recipient_binding" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "recipient_phone" TEXT NOT NULL,
    "recipient_phone_mask" TEXT,
    "label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "linq_recipient_binding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linq_webhook_event" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "binding_id" TEXT NOT NULL,
    "recipient_phone" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "trace_id" TEXT,
    "event_type" TEXT NOT NULL,
    "chat_id" TEXT,
    "message_id" TEXT,
    "occurred_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "linq_webhook_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_connection_user_id_provider_idx" ON "device_connection"("user_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "device_connection_provider_provider_account_blind_index_key" ON "device_connection"("provider", "provider_account_blind_index");

-- CreateIndex
CREATE INDEX "device_token_audit_user_id_id_idx" ON "device_token_audit"("user_id", "id");

-- CreateIndex
CREATE INDEX "device_token_audit_connection_id_created_at_idx" ON "device_token_audit"("connection_id", "created_at");

-- CreateIndex
CREATE INDEX "device_token_audit_created_at_idx" ON "device_token_audit"("created_at");

-- CreateIndex
CREATE INDEX "device_oauth_session_expires_at_idx" ON "device_oauth_session"("expires_at");

-- CreateIndex
CREATE INDEX "device_oauth_session_user_id_provider_idx" ON "device_oauth_session"("user_id", "provider");

-- CreateIndex
CREATE INDEX "device_webhook_trace_provider_provider_account_blind_index_idx" ON "device_webhook_trace"("provider", "provider_account_blind_index");

-- CreateIndex
CREATE INDEX "device_webhook_trace_received_at_idx" ON "device_webhook_trace"("received_at");

-- CreateIndex
CREATE INDEX "device_sync_signal_user_id_id_idx" ON "device_sync_signal"("user_id", "id");

-- CreateIndex
CREATE INDEX "device_sync_signal_connection_id_idx" ON "device_sync_signal"("connection_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_agent_session_token_hash_key" ON "device_agent_session"("token_hash");

-- CreateIndex
CREATE INDEX "device_agent_session_user_id_idx" ON "device_agent_session"("user_id");

-- CreateIndex
CREATE INDEX "device_agent_session_expires_at_idx" ON "device_agent_session"("expires_at");

-- CreateIndex
CREATE INDEX "device_agent_session_revoked_at_idx" ON "device_agent_session"("revoked_at");

-- CreateIndex
CREATE INDEX "device_agent_session_replaced_by_session_id_idx" ON "device_agent_session"("replaced_by_session_id");

-- CreateIndex
CREATE INDEX "device_browser_assertion_nonce_user_id_expires_at_idx" ON "device_browser_assertion_nonce"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "device_browser_assertion_nonce_expires_at_idx" ON "device_browser_assertion_nonce"("expires_at");

-- CreateIndex
CREATE INDEX "hosted_web_internal_request_nonce_user_id_expires_at_idx" ON "hosted_web_internal_request_nonce"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "hosted_web_internal_request_nonce_expires_at_idx" ON "hosted_web_internal_request_nonce"("expires_at");

-- CreateIndex
CREATE INDEX "hosted_member_billing_status_idx" ON "hosted_member"("billing_status");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_member_identity_member_id_key" ON "hosted_member_identity"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_member_identity_phone_lookup_key_key" ON "hosted_member_identity"("phone_lookup_key");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_member_identity_privy_user_lookup_key_key" ON "hosted_member_identity"("privy_user_lookup_key");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_member_identity_wallet_address_lookup_key_key" ON "hosted_member_identity"("wallet_address_lookup_key");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_member_routing_member_id_key" ON "hosted_member_routing"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_member_routing_linq_chat_lookup_key_key" ON "hosted_member_routing"("linq_chat_lookup_key");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_member_routing_pending_linq_chat_lookup_key_key" ON "hosted_member_routing"("pending_linq_chat_lookup_key");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_member_routing_reply_alias_lookup_key_key" ON "hosted_member_routing"("reply_alias_lookup_key");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_member_routing_telegram_user_lookup_key_key" ON "hosted_member_routing"("telegram_user_lookup_key");

-- CreateIndex
CREATE INDEX "hosted_member_routing_linq_recipient_phone_lookup_key_idx" ON "hosted_member_routing"("linq_recipient_phone_lookup_key");

-- CreateIndex
CREATE INDEX "hosted_member_routing_pending_linq_recipient_phone_lookup_k_idx" ON "hosted_member_routing"("pending_linq_recipient_phone_lookup_key");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_member_billing_ref_member_id_key" ON "hosted_member_billing_ref"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_member_billing_ref_stripe_customer_lookup_key_key" ON "hosted_member_billing_ref"("stripe_customer_lookup_key");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_member_billing_ref_stripe_subscription_lookup_key_key" ON "hosted_member_billing_ref"("stripe_subscription_lookup_key");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_member_email_authorization_member_id_key" ON "hosted_member_email_authorization"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_member_email_authorization_verified_email_lookup_key_key" ON "hosted_member_email_authorization"("verified_email_lookup_key");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_member_email_authorization_direct_public_sender_look_key" ON "hosted_member_email_authorization"("direct_public_sender_lookup_key");

-- CreateIndex
CREATE INDEX "hosted_ingress_event_user_id_seq_idx" ON "hosted_ingress_event"("user_id", "seq");

-- CreateIndex
CREATE INDEX "hosted_ingress_event_user_id_state_seq_idx" ON "hosted_ingress_event"("user_id", "state", "seq");

-- CreateIndex
CREATE INDEX "hosted_ingress_event_run_id_idx" ON "hosted_ingress_event"("run_id");

-- CreateIndex
CREATE INDEX "hosted_ingress_event_user_id_coalescing_key_seq_idx" ON "hosted_ingress_event"("user_id", "coalescing_key", "seq");

-- CreateIndex
CREATE INDEX "hosted_ingress_event_user_id_kind_seq_idx" ON "hosted_ingress_event"("user_id", "kind", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_ingress_event_user_id_seq_key" ON "hosted_ingress_event"("user_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_ingress_event_user_id_dedupe_key_key" ON "hosted_ingress_event"("user_id", "dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_run_run_token_hash_key" ON "hosted_run"("run_token_hash");

-- CreateIndex
CREATE INDEX "hosted_run_user_id_created_at_idx" ON "hosted_run"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "hosted_run_user_id_status_created_at_idx" ON "hosted_run"("user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "hosted_run_status_created_at_idx" ON "hosted_run"("status", "created_at");

-- CreateIndex
CREATE INDEX "hosted_run_trigger_kind_created_at_idx" ON "hosted_run"("trigger_kind", "created_at");

-- CreateIndex
CREATE INDEX "hosted_run_log_user_id_at_idx" ON "hosted_run_log"("user_id", "at");

-- CreateIndex
CREATE INDEX "hosted_run_log_run_id_at_idx" ON "hosted_run_log"("run_id", "at");

-- CreateIndex
CREATE INDEX "hosted_run_log_level_at_idx" ON "hosted_run_log"("level", "at");

-- CreateIndex
CREATE INDEX "hosted_ingress_event_alias_event_id_idx" ON "hosted_ingress_event_alias"("event_id");

-- CreateIndex
CREATE INDEX "hosted_ingress_event_alias_user_id_idx" ON "hosted_ingress_event_alias"("user_id");

-- CreateIndex
CREATE INDEX "hosted_ingress_event_alias_user_id_replaced_by_event_id_idx" ON "hosted_ingress_event_alias"("user_id", "replaced_by_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_ingress_event_alias_user_id_ingress_event_id_current_key" ON "hosted_ingress_event_alias"("user_id", "ingress_event_id") WHERE "replaced_by_event_id" IS NULL;

-- CreateIndex
CREATE INDEX "hosted_ingress_event_alias_ingress_event_id_idx" ON "hosted_ingress_event_alias"("ingress_event_id");

-- CreateIndex
CREATE INDEX "hosted_ingress_payload_user_id_idx" ON "hosted_ingress_payload"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_invite_invite_code_key" ON "hosted_invite"("invite_code");

-- CreateIndex
CREATE INDEX "hosted_invite_member_id_created_at_idx" ON "hosted_invite"("member_id", "created_at");

-- CreateIndex
CREATE INDEX "hosted_invite_expires_at_idx" ON "hosted_invite"("expires_at");

-- CreateIndex
CREATE INDEX "hosted_stripe_event_status_stripe_created_at_created_at_idx" ON "hosted_stripe_event"("status", "stripe_created_at", "created_at");

-- CreateIndex
CREATE INDEX "hosted_stripe_event_status_next_attempt_at_stripe_created_a_idx" ON "hosted_stripe_event"("status", "next_attempt_at", "stripe_created_at", "created_at");

-- CreateIndex
CREATE INDEX "hosted_stripe_event_claim_expires_at_idx" ON "hosted_stripe_event"("claim_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_share_link_code_hash_key" ON "hosted_share_link"("code_hash");

-- CreateIndex
CREATE INDEX "hosted_share_link_sender_member_id_created_at_idx" ON "hosted_share_link"("sender_member_id", "created_at");

-- CreateIndex
CREATE INDEX "hosted_share_link_expires_at_idx" ON "hosted_share_link"("expires_at");

-- CreateIndex
CREATE INDEX "hosted_share_link_accepted_by_member_id_accepted_at_idx" ON "hosted_share_link"("accepted_by_member_id", "accepted_at");

-- CreateIndex
CREATE INDEX "hosted_share_link_consumed_by_member_id_consumed_at_idx" ON "hosted_share_link"("consumed_by_member_id", "consumed_at");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_share_payload_share_id_key" ON "hosted_share_payload"("share_id");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_vault_sync_session_pairing_code_hash_key" ON "hosted_vault_sync_session"("pairing_code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_vault_sync_session_agent_token_hash_key" ON "hosted_vault_sync_session"("agent_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_vault_sync_session_queued_ingress_event_id_key" ON "hosted_vault_sync_session"("queued_ingress_event_id");

-- CreateIndex
CREATE INDEX "hosted_vault_sync_session_member_id_created_at_idx" ON "hosted_vault_sync_session"("member_id", "created_at");

-- CreateIndex
CREATE INDEX "hosted_vault_sync_session_member_id_status_created_at_idx" ON "hosted_vault_sync_session"("member_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "hosted_vault_sync_session_expires_at_idx" ON "hosted_vault_sync_session"("expires_at");

-- CreateIndex
CREATE INDEX "hosted_vault_sync_payload_member_id_created_at_idx" ON "hosted_vault_sync_payload"("member_id", "created_at");

-- CreateIndex
CREATE INDEX "hosted_ai_usage_feature_key_created_at_idx" ON "hosted_ai_usage"("feature_key", "created_at");

-- CreateIndex
CREATE INDEX "hosted_ai_usage_member_id_occurred_at_idx" ON "hosted_ai_usage"("member_id", "occurred_at");

-- CreateIndex
CREATE INDEX "hosted_ai_usage_reporting_user_id_created_at_idx" ON "hosted_ai_usage"("reporting_user_id", "created_at");

-- CreateIndex
CREATE INDEX "hosted_ai_usage_stripe_meter_due_idx" ON "hosted_ai_usage"("stripe_meter_status", "stripe_meter_next_attempt_at", "occurred_at");

-- CreateIndex
CREATE INDEX "hosted_ai_usage_surface_created_at_idx" ON "hosted_ai_usage"("surface", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_ai_usage_turn_id_attempt_count_idx" ON "hosted_ai_usage"("turn_id", "attempt_count");

-- CreateIndex
CREATE INDEX "hosted_assistant_runtime_issue_fingerprint_occurred_at_idx" ON "hosted_assistant_runtime_issue"("fingerprint", "occurred_at");

-- CreateIndex
CREATE INDEX "hosted_assistant_runtime_issue_severity_occurred_at_idx" ON "hosted_assistant_runtime_issue"("severity", "occurred_at");

-- CreateIndex
CREATE INDEX "hosted_assistant_runtime_issue_issue_kind_occurred_at_idx" ON "hosted_assistant_runtime_issue"("issue_kind", "occurred_at");

-- CreateIndex
CREATE INDEX "hosted_assistant_runtime_issue_expires_at_idx" ON "hosted_assistant_runtime_issue"("expires_at");

-- CreateIndex
CREATE INDEX "hosted_linq_daily_state_day_utc_idx" ON "hosted_linq_daily_state"("day_utc");

-- CreateIndex
CREATE INDEX "linq_recipient_binding_user_id_recipient_phone_idx" ON "linq_recipient_binding"("user_id", "recipient_phone");

-- CreateIndex
CREATE INDEX "linq_recipient_binding_user_id_recipient_phone_mask_idx" ON "linq_recipient_binding"("user_id", "recipient_phone_mask");

-- CreateIndex
CREATE UNIQUE INDEX "linq_recipient_binding_recipient_phone_key" ON "linq_recipient_binding"("recipient_phone");

-- CreateIndex
CREATE INDEX "linq_webhook_event_event_id_idx" ON "linq_webhook_event"("event_id");

-- CreateIndex
CREATE INDEX "linq_webhook_event_user_id_id_idx" ON "linq_webhook_event"("user_id", "id");

-- CreateIndex
CREATE INDEX "linq_webhook_event_binding_id_id_idx" ON "linq_webhook_event"("binding_id", "id");

-- CreateIndex
CREATE INDEX "linq_webhook_event_recipient_phone_id_idx" ON "linq_webhook_event"("recipient_phone", "id");

-- CreateIndex
CREATE INDEX "linq_webhook_event_received_at_idx" ON "linq_webhook_event"("received_at");

-- CreateIndex
CREATE UNIQUE INDEX "linq_webhook_event_user_id_event_id_key" ON "linq_webhook_event"("user_id", "event_id");

-- AddForeignKey
ALTER TABLE "device_token_audit" ADD CONSTRAINT "device_token_audit_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "device_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_sync_signal" ADD CONSTRAINT "device_sync_signal_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "device_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_member_identity" ADD CONSTRAINT "hosted_member_identity_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_member_routing" ADD CONSTRAINT "hosted_member_routing_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_member_billing_ref" ADD CONSTRAINT "hosted_member_billing_ref_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_member_email_authorization" ADD CONSTRAINT "hosted_member_email_authorization_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_execution_cursor" ADD CONSTRAINT "hosted_execution_cursor_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_ingress_event" ADD CONSTRAINT "hosted_ingress_event_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_ingress_event" ADD CONSTRAINT "hosted_ingress_event_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "hosted_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_run" ADD CONSTRAINT "hosted_run_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_run_log" ADD CONSTRAINT "hosted_run_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_run_log" ADD CONSTRAINT "hosted_run_log_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "hosted_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_ingress_event_alias" ADD CONSTRAINT "hosted_ingress_event_alias_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_ingress_event_alias" ADD CONSTRAINT "hosted_ingress_event_alias_ingress_event_id_fkey" FOREIGN KEY ("ingress_event_id") REFERENCES "hosted_ingress_event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_ingress_event_alias" ADD CONSTRAINT "hosted_ingress_event_alias_user_id_replaced_by_event_id_fkey" FOREIGN KEY ("user_id", "replaced_by_event_id") REFERENCES "hosted_ingress_event_alias"("user_id", "event_id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- AddForeignKey
ALTER TABLE "hosted_ingress_payload" ADD CONSTRAINT "hosted_ingress_payload_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_ingress_payload" ADD CONSTRAINT "hosted_ingress_payload_ingress_event_id_fkey" FOREIGN KEY ("ingress_event_id") REFERENCES "hosted_ingress_event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_invite" ADD CONSTRAINT "hosted_invite_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_share_payload" ADD CONSTRAINT "hosted_share_payload_share_id_fkey" FOREIGN KEY ("share_id") REFERENCES "hosted_share_link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_vault_sync_session" ADD CONSTRAINT "hosted_vault_sync_session_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_vault_sync_payload" ADD CONSTRAINT "hosted_vault_sync_payload_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_vault_sync_payload" ADD CONSTRAINT "hosted_vault_sync_payload_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "hosted_vault_sync_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_ai_usage" ADD CONSTRAINT "hosted_ai_usage_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_linq_daily_state" ADD CONSTRAINT "hosted_linq_daily_state_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linq_webhook_event" ADD CONSTRAINT "linq_webhook_event_binding_id_fkey" FOREIGN KEY ("binding_id") REFERENCES "linq_recipient_binding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
