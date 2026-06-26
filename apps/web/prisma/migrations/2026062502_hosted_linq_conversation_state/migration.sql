CREATE TABLE "hosted_linq_conversation_state" (
  "linq_chat_lookup_key" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "line_phone_number_lookup_key" TEXT,
  "health_status" TEXT NOT NULL DEFAULT 'AT_RISK',
  "provider_health_status" TEXT,
  "provider_health_reason" TEXT,
  "provider_health_checked_at" TIMESTAMP(3),
  "health_reason" TEXT,
  "paused_at" TIMESTAMP(3),
  "terminal_at" TIMESTAMP(3),
  "recipient_reply_count" INTEGER NOT NULL DEFAULT 0,
  "total_outbound_count" INTEGER NOT NULL DEFAULT 0,
  "outbound_since_last_inbound_count" INTEGER NOT NULL DEFAULT 0,
  "trusted_at" TIMESTAMP(3),
  "first_inbound_at" TIMESTAMP(3),
  "last_inbound_at" TIMESTAMP(3),
  "last_inbound_event_id" TEXT,
  "last_outbound_at" TIMESTAMP(3),
  "last_outbound_event_id" TEXT,
  "last_delivered_at" TIMESTAMP(3),
  "last_failed_at" TIMESTAMP(3),
  "last_receipt_at" TIMESTAMP(3),
  "last_receipt_event_id" TEXT,
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  "recovered_from_chat_lookup_key" TEXT,
  "replaced_by_chat_lookup_key" TEXT,
  "replaced_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hosted_linq_conversation_state_pkey" PRIMARY KEY ("linq_chat_lookup_key")
);

CREATE INDEX "hosted_linq_conversation_state_member_health_idx"
  ON "hosted_linq_conversation_state"("member_id", "health_status");

CREATE INDEX "hosted_linq_conversation_state_line_health_idx"
  ON "hosted_linq_conversation_state"("line_phone_number_lookup_key", "health_status");

CREATE INDEX "hosted_linq_conversation_state_trusted_at_idx"
  ON "hosted_linq_conversation_state"("trusted_at");

CREATE INDEX "hosted_linq_conversation_state_last_inbound_at_idx"
  ON "hosted_linq_conversation_state"("last_inbound_at");

CREATE INDEX "hosted_linq_conversation_state_last_receipt_at_idx"
  ON "hosted_linq_conversation_state"("last_receipt_at");

ALTER TABLE "hosted_linq_conversation_state"
  ADD CONSTRAINT "hosted_linq_conversation_state_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hosted_linq_conversation_state"
  ADD CONSTRAINT "hosted_linq_conversation_state_line_phone_number_lookup_key_fkey"
  FOREIGN KEY ("line_phone_number_lookup_key") REFERENCES "hosted_linq_line"("phone_number_lookup_key") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "hosted_linq_conversation_state" (
  "linq_chat_lookup_key",
  "member_id",
  "health_status",
  "first_inbound_at",
  "last_inbound_at",
  "recipient_reply_count",
  "outbound_since_last_inbound_count",
  "created_at",
  "updated_at"
)
SELECT
  r."linq_chat_lookup_key",
  r."member_id",
  'AT_RISK',
  r."linq_last_inbound_at",
  r."linq_last_inbound_at",
  CASE WHEN r."linq_last_inbound_at" IS NULL THEN 0 ELSE 1 END,
  CASE WHEN r."linq_last_inbound_at" IS NULL THEN 0 ELSE 1 END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "hosted_member_routing" r
WHERE r."linq_chat_lookup_key" IS NOT NULL
ON CONFLICT ("linq_chat_lookup_key") DO NOTHING;

INSERT INTO "hosted_linq_conversation_state" (
  "linq_chat_lookup_key",
  "member_id",
  "health_status",
  "first_inbound_at",
  "last_inbound_at",
  "recipient_reply_count",
  "outbound_since_last_inbound_count",
  "created_at",
  "updated_at"
)
SELECT
  r."pending_linq_chat_lookup_key",
  r."member_id",
  'AT_RISK',
  r."pending_linq_last_inbound_at",
  r."pending_linq_last_inbound_at",
  CASE WHEN r."pending_linq_last_inbound_at" IS NULL THEN 0 ELSE 1 END,
  CASE WHEN r."pending_linq_last_inbound_at" IS NULL THEN 0 ELSE 1 END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "hosted_member_routing" r
WHERE r."pending_linq_chat_lookup_key" IS NOT NULL
ON CONFLICT ("linq_chat_lookup_key") DO NOTHING;
