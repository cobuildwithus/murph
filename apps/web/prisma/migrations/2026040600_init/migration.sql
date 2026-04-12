-- Murph hosted Prisma baseline generated from prisma/schema.prisma on 2026-04-09.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "HostedBillingStatus" AS ENUM ('not_started', 'active', 'incomplete', 'past_due', 'canceled', 'unpaid', 'paused');

-- CreateEnum
CREATE TYPE "HostedStripeEventStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'poisoned');

-- CreateEnum
CREATE TYPE "HostedRevnetIssuanceStatus" AS ENUM ('pending', 'submitting', 'submitted', 'confirmed', 'failed');

-- CreateEnum
CREATE TYPE "ExecutionOutboxStatus" AS ENUM ('queued', 'dispatching', 'dispatched', 'delivery_failed');

-- CreateEnum
CREATE TYPE "HostedWebhookReceiptStatus" AS ENUM ('processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "HostedWebhookReceiptSideEffectKind" AS ENUM ('hosted_execution_dispatch', 'linq_message_send', 'revnet_invoice_issue');

-- CreateEnum
CREATE TYPE "HostedWebhookReceiptSideEffectStatus" AS ENUM ('pending', 'sent_unconfirmed');

-- CreateTable
CREATE TABLE "device_connection" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_blind_index" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
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
    "masked_phone_number_hint" TEXT NOT NULL,
    "phone_lookup_key" TEXT NOT NULL,
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
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL
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
CREATE TABLE "hosted_revnet_issuance" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "stripe_invoice_id" TEXT NOT NULL,
    "stripe_payment_intent_id" TEXT,
    "stripe_charge_id" TEXT,
    "chain_id" INTEGER NOT NULL,
    "project_id" TEXT NOT NULL,
    "terminal_address" TEXT NOT NULL,
    "payment_asset_address" TEXT NOT NULL,
    "beneficiary_address" TEXT NOT NULL,
    "stripe_payment_amount_minor" INTEGER NOT NULL,
    "stripe_payment_currency" TEXT NOT NULL,
    "payment_amount" TEXT NOT NULL,
    "status" "HostedRevnetIssuanceStatus" NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pay_tx_hash" TEXT,
    "failure_code" TEXT,
    "failure_message" TEXT,
    "submitted_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_revnet_issuance_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "hosted_webhook_receipt" (
    "source" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "status" "HostedWebhookReceiptStatus" NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "attempt_id" TEXT NOT NULL,
    "first_received_at" TIMESTAMP(3) NOT NULL,
    "last_received_at" TIMESTAMP(3) NOT NULL,
    "planned_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "claim_expires_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "last_error_name" TEXT,
    "last_error_retryable" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_webhook_receipt_pkey" PRIMARY KEY ("source","event_id")
);

-- CreateTable
CREATE TABLE "hosted_webhook_receipt_side_effect" (
    "source" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "effect_id" TEXT NOT NULL,
    "kind" "HostedWebhookReceiptSideEffectKind" NOT NULL,
    "status" "HostedWebhookReceiptSideEffectStatus" NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "last_error_name" TEXT,
    "last_error_retryable" BOOLEAN,
    "payload_json" JSONB NOT NULL,
    "result_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_webhook_receipt_side_effect_pkey" PRIMARY KEY ("source","event_id","effect_id")
);

-- CreateTable
CREATE TABLE "execution_outbox" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT,
    "event_id" TEXT NOT NULL,
    "event_kind" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "dispatch_state" TEXT NOT NULL DEFAULT 'queued',
    "status" "ExecutionOutboxStatus" NOT NULL DEFAULT 'queued',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "next_attempt_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "claim_token" TEXT,
    "claim_expires_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "execution_outbox_pkey" PRIMARY KEY ("id")
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
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "reasoning_tokens" INTEGER,
    "cached_input_tokens" INTEGER,
    "cache_write_tokens" INTEGER,
    "total_tokens" INTEGER,
    "stripe_meter_status" TEXT NOT NULL DEFAULT 'pending',
    "stripe_metered_at" TIMESTAMP(3),
    "stripe_meter_identifier" TEXT,
    "stripe_meter_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_ai_usage_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "hosted_member_routing_linq_recipient_phone_lookup_key_idx" ON "hosted_member_routing"("linq_recipient_phone_lookup_key");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_member_routing_pending_linq_chat_lookup_key_key" ON "hosted_member_routing"("pending_linq_chat_lookup_key");

-- CreateIndex
CREATE INDEX "hosted_member_routing_pending_linq_recipient_phone_lookup_key_idx" ON "hosted_member_routing"("pending_linq_recipient_phone_lookup_key");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_member_routing_telegram_user_lookup_key_key" ON "hosted_member_routing"("telegram_user_lookup_key");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_member_billing_ref_member_id_key" ON "hosted_member_billing_ref"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_member_billing_ref_stripe_customer_lookup_key_key" ON "hosted_member_billing_ref"("stripe_customer_lookup_key");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_member_billing_ref_stripe_subscription_lookup_key_key" ON "hosted_member_billing_ref"("stripe_subscription_lookup_key");

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
CREATE UNIQUE INDEX "hosted_revnet_issuance_idempotency_key_key" ON "hosted_revnet_issuance"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_revnet_issuance_stripe_invoice_id_key" ON "hosted_revnet_issuance"("stripe_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "hosted_revnet_issuance_pay_tx_hash_key" ON "hosted_revnet_issuance"("pay_tx_hash");

-- CreateIndex
CREATE INDEX "hosted_revnet_issuance_member_id_created_at_idx" ON "hosted_revnet_issuance"("member_id", "created_at");

-- CreateIndex
CREATE INDEX "hosted_revnet_issuance_status_created_at_idx" ON "hosted_revnet_issuance"("status", "created_at");

-- CreateIndex
CREATE INDEX "hosted_revnet_issuance_status_next_attempt_at_created_at_idx" ON "hosted_revnet_issuance"("status", "next_attempt_at", "created_at");

-- CreateIndex
CREATE INDEX "hosted_revnet_issuance_stripe_payment_intent_id_idx" ON "hosted_revnet_issuance"("stripe_payment_intent_id");

-- CreateIndex
CREATE INDEX "hosted_revnet_issuance_stripe_charge_id_idx" ON "hosted_revnet_issuance"("stripe_charge_id");

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
CREATE INDEX "hosted_webhook_receipt_first_received_at_idx" ON "hosted_webhook_receipt"("first_received_at");

-- CreateIndex
CREATE INDEX "hosted_webhook_receipt_status_claim_expires_at_first_receiv_idx" ON "hosted_webhook_receipt"("status", "claim_expires_at", "first_received_at");

-- CreateIndex
CREATE INDEX "hosted_webhook_receipt_side_effect_source_event_id_status_idx" ON "hosted_webhook_receipt_side_effect"("source", "event_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "execution_outbox_event_id_key" ON "execution_outbox"("event_id");

-- CreateIndex
CREATE INDEX "execution_outbox_status_next_attempt_at_created_at_idx" ON "execution_outbox"("status", "next_attempt_at", "created_at");

-- CreateIndex
CREATE INDEX "execution_outbox_user_id_created_at_idx" ON "execution_outbox"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "hosted_ai_usage_member_id_occurred_at_idx" ON "hosted_ai_usage"("member_id", "occurred_at");

-- CreateIndex
CREATE INDEX "hosted_ai_usage_stripe_meter_status_occurred_at_idx" ON "hosted_ai_usage"("stripe_meter_status", "occurred_at");

-- CreateIndex
CREATE INDEX "hosted_ai_usage_turn_id_attempt_count_idx" ON "hosted_ai_usage"("turn_id", "attempt_count");

-- CreateIndex
CREATE INDEX "hosted_linq_daily_state_day_utc_idx" ON "hosted_linq_daily_state"("day_utc");

-- CreateIndex
CREATE INDEX "linq_recipient_binding_user_id_recipient_phone_idx" ON "linq_recipient_binding"("user_id", "recipient_phone");

-- CreateIndex
CREATE INDEX "linq_recipient_binding_user_id_recipient_phone_mask_idx" ON "linq_recipient_binding"("user_id", "recipient_phone_mask");

-- CreateIndex
CREATE UNIQUE INDEX "linq_recipient_binding_recipient_phone_key" ON "linq_recipient_binding"("recipient_phone");

-- CreateIndex
CREATE UNIQUE INDEX "linq_webhook_event_event_id_key" ON "linq_webhook_event"("event_id");

-- CreateIndex
CREATE INDEX "linq_webhook_event_user_id_id_idx" ON "linq_webhook_event"("user_id", "id");

-- CreateIndex
CREATE INDEX "linq_webhook_event_binding_id_id_idx" ON "linq_webhook_event"("binding_id", "id");

-- CreateIndex
CREATE INDEX "linq_webhook_event_recipient_phone_id_idx" ON "linq_webhook_event"("recipient_phone", "id");

-- CreateIndex
CREATE INDEX "linq_webhook_event_received_at_idx" ON "linq_webhook_event"("received_at");

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
ALTER TABLE "hosted_invite" ADD CONSTRAINT "hosted_invite_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_revnet_issuance" ADD CONSTRAINT "hosted_revnet_issuance_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_webhook_receipt_side_effect" ADD CONSTRAINT "hosted_webhook_receipt_side_effect_source_event_id_fkey" FOREIGN KEY ("source", "event_id") REFERENCES "hosted_webhook_receipt"("source", "event_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_ai_usage" ADD CONSTRAINT "hosted_ai_usage_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_linq_daily_state" ADD CONSTRAINT "hosted_linq_daily_state_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linq_webhook_event" ADD CONSTRAINT "linq_webhook_event_binding_id_fkey" FOREIGN KEY ("binding_id") REFERENCES "linq_recipient_binding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
