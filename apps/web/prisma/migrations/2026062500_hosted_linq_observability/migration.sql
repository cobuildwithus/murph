CREATE TABLE "hosted_linq_line" (
  "phone_number_lookup_key" TEXT NOT NULL,
  "phone_number" TEXT NOT NULL,
  "phone_number_hint" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'unknown',
  "configured_at" TIMESTAMP(3),
  "provider_seen_at" TIMESTAMP(3),
  "health_status" TEXT NOT NULL DEFAULT 'unknown',
  "egress_policy" TEXT NOT NULL DEFAULT 'enabled',
  "provider_status" TEXT,
  "provider_reason" TEXT,
  "provider_updated_at" TIMESTAMP(3),
  "last_status_event_id" TEXT,
  "last_outbound_at" TIMESTAMP(3),
  "last_delivered_at" TIMESTAMP(3),
  "last_failed_at" TIMESTAMP(3),
  "last_receipt_at" TIMESTAMP(3),
  "last_receipt_event_id" TEXT,
  "last_failure_code" TEXT,
  "last_failure_reason" TEXT,
  "last_inbound_at" TIMESTAMP(3),
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  "total_outbound_count" INTEGER NOT NULL DEFAULT 0,
  "total_delivered_count" INTEGER NOT NULL DEFAULT 0,
  "total_failed_count" INTEGER NOT NULL DEFAULT 0,
  "total_inbound_count" INTEGER NOT NULL DEFAULT 0,
  "active_member_limit" INTEGER,
  "max_new_conversations_per_day" INTEGER,
  "max_outbound_per_day" INTEGER,
  "warmup_started_at" TIMESTAMP(3),
  "warmup_ends_at" TIMESTAMP(3),
  "assignment_weight" INTEGER NOT NULL DEFAULT 100,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hosted_linq_line_pkey" PRIMARY KEY ("phone_number_lookup_key")
);

CREATE UNIQUE INDEX "hosted_linq_line_phone_number_key" ON "hosted_linq_line"("phone_number");
CREATE INDEX "hosted_linq_line_health_status_egress_policy_idx" ON "hosted_linq_line"("health_status", "egress_policy");
CREATE INDEX "hosted_linq_line_provider_status_idx" ON "hosted_linq_line"("provider_status");
CREATE INDEX "hosted_linq_line_last_failed_at_idx" ON "hosted_linq_line"("last_failed_at");
CREATE INDEX "hosted_linq_line_last_receipt_at_idx" ON "hosted_linq_line"("last_receipt_at");

CREATE TABLE "hosted_linq_provider_event" (
  "event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "api_version" TEXT,
  "webhook_version" TEXT,
  "trace_id_suffix" TEXT,
  "provider_created_at" TIMESTAMP(3) NOT NULL,
  "received_at" TIMESTAMP(3) NOT NULL,
  "phone_number_lookup_key" TEXT,
  "phone_number_hint" TEXT,
  "phone_number_role" TEXT,
  "linq_chat_lookup_key" TEXT,
  "message_lookup_key" TEXT,
  "message_id_suffix" TEXT,
  "direction" TEXT,
  "service" TEXT,
  "delivery_status" TEXT,
  "failure_code" TEXT,
  "failure_reason" TEXT,
  "provider_status" TEXT,
  "provider_reason" TEXT,
  "extraction_version" INTEGER NOT NULL DEFAULT 1,
  "extraction_json" JSONB,
  "payload_shape_json" JSONB,
  "payload_sanitized_json" JSONB,
  "payload_hash" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hosted_linq_provider_event_pkey" PRIMARY KEY ("event_id")
);

CREATE INDEX "hosted_linq_provider_event_event_type_provider_created_at_idx" ON "hosted_linq_provider_event"("event_type", "provider_created_at");
CREATE INDEX "hosted_linq_provider_event_phone_number_lookup_key_provider_created_at_idx" ON "hosted_linq_provider_event"("phone_number_lookup_key", "provider_created_at");
CREATE INDEX "hosted_linq_provider_event_phone_number_lookup_key_event_type_provider_created_at_idx" ON "hosted_linq_provider_event"("phone_number_lookup_key", "event_type", "provider_created_at");
CREATE INDEX "hosted_linq_provider_event_message_lookup_key_provider_created_at_idx" ON "hosted_linq_provider_event"("message_lookup_key", "provider_created_at");
CREATE INDEX "hosted_linq_provider_event_delivery_status_provider_created_at_idx" ON "hosted_linq_provider_event"("delivery_status", "provider_created_at");

CREATE TABLE "hosted_linq_delivery" (
  "id" TEXT NOT NULL,
  "idempotency_key" TEXT,
  "source" TEXT NOT NULL,
  "source_ref" TEXT,
  "template" TEXT,
  "phone_number_lookup_key" TEXT,
  "phone_number_hint" TEXT,
  "target_kind" TEXT,
  "linq_chat_lookup_key" TEXT,
  "message_lookup_key" TEXT,
  "message_id_suffix" TEXT,
  "service" TEXT,
  "status" TEXT NOT NULL DEFAULT 'attempted',
  "attempted_at" TIMESTAMP(3) NOT NULL,
  "accepted_at" TIMESTAMP(3),
  "delivered_at" TIMESTAMP(3),
  "failed_at" TIMESTAMP(3),
  "skipped_at" TIMESTAMP(3),
  "last_receipt_at" TIMESTAMP(3),
  "last_provider_event_id" TEXT,
  "failure_code" TEXT,
  "failure_reason" TEXT,
  "skip_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hosted_linq_delivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hosted_linq_delivery_idempotency_key_key" ON "hosted_linq_delivery"("idempotency_key");
CREATE UNIQUE INDEX "hosted_linq_delivery_message_lookup_key_key" ON "hosted_linq_delivery"("message_lookup_key");
CREATE INDEX "hosted_linq_delivery_phone_number_lookup_key_attempted_at_idx" ON "hosted_linq_delivery"("phone_number_lookup_key", "attempted_at");
CREATE INDEX "hosted_linq_delivery_status_attempted_at_idx" ON "hosted_linq_delivery"("status", "attempted_at");
CREATE INDEX "hosted_linq_delivery_linq_chat_lookup_key_attempted_at_idx" ON "hosted_linq_delivery"("linq_chat_lookup_key", "attempted_at");
CREATE INDEX "hosted_linq_delivery_last_receipt_at_idx" ON "hosted_linq_delivery"("last_receipt_at");

CREATE TABLE "hosted_linq_alert" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "event_id" TEXT,
  "delivery_id" TEXT,
  "phone_number_lookup_key" TEXT,
  "phone_number_hint" TEXT,
  "subject" TEXT NOT NULL,
  "details_json" JSONB NOT NULL,
  "claimed_at" TIMESTAMP(3) NOT NULL,
  "last_attempted_at" TIMESTAMP(3),
  "sent_at" TIMESTAMP(3),
  "provider_message_id" TEXT,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_error_code" TEXT,
  "last_provider_status" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hosted_linq_alert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hosted_linq_alert_kind_event_id_key" ON "hosted_linq_alert"("kind", "event_id");
CREATE INDEX "hosted_linq_alert_status_claimed_at_idx" ON "hosted_linq_alert"("status", "claimed_at");
CREATE INDEX "hosted_linq_alert_phone_number_lookup_key_created_at_idx" ON "hosted_linq_alert"("phone_number_lookup_key", "created_at");

ALTER TABLE "hosted_linq_provider_event"
  ADD CONSTRAINT "hosted_linq_provider_event_phone_number_lookup_key_fkey"
  FOREIGN KEY ("phone_number_lookup_key") REFERENCES "hosted_linq_line"("phone_number_lookup_key") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "hosted_linq_delivery"
  ADD CONSTRAINT "hosted_linq_delivery_phone_number_lookup_key_fkey"
  FOREIGN KEY ("phone_number_lookup_key") REFERENCES "hosted_linq_line"("phone_number_lookup_key") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "hosted_linq_alert"
  ADD CONSTRAINT "hosted_linq_alert_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "hosted_linq_provider_event"("event_id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "hosted_linq_alert"
  ADD CONSTRAINT "hosted_linq_alert_delivery_id_fkey"
  FOREIGN KEY ("delivery_id") REFERENCES "hosted_linq_delivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "hosted_linq_alert"
  ADD CONSTRAINT "hosted_linq_alert_phone_number_lookup_key_fkey"
  FOREIGN KEY ("phone_number_lookup_key") REFERENCES "hosted_linq_line"("phone_number_lookup_key") ON DELETE SET NULL ON UPDATE CASCADE;
