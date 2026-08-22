-- Empty cutover by design: only successful Telegram/email deliveries whose
-- durable runtime outbox owner opts in after deployment create receipts. There
-- is no reconstruction of unavailable pre-cutover provider history.
CREATE TABLE "hosted_outbound_message_volume_receipt" (
  "receipt_lookup_key" VARCHAR(64) NOT NULL,
  "channel" VARCHAR(16) NOT NULL,
  "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "hosted_outbound_message_volume_receipt_pkey"
    PRIMARY KEY ("receipt_lookup_key"),
  CONSTRAINT "homvr_receipt_lookup_key_format_check"
    CHECK ("receipt_lookup_key" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "homvr_channel_check"
    CHECK ("channel" IN ('email', 'telegram'))
);

CREATE INDEX "homvr_recorded_at_idx"
  ON "hosted_outbound_message_volume_receipt" ("recorded_at");

COMMENT ON TABLE "hosted_outbound_message_volume_receipt" IS
  'Anonymous exact-once post-cutover receipts for successful conversational Telegram/email deliveries; recorded_at is database receipt time.';
