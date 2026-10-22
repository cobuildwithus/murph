-- Additive: existing delivery payloads are excluded from bootstrap recovery.
ALTER TABLE "hosted_linq_delivery"
  ADD COLUMN "bootstrap_route_attached_at" TIMESTAMP(3);

-- Route recovery survives accepted/delivered receipts clearing provider retry fields.
CREATE INDEX "hosted_linq_delivery_bootstrap_pending_idx"
  ON "hosted_linq_delivery" ("attempted_at", "id")
  WHERE "source" = 'game_lifecycle'
    AND "payload_schema" = 'game_chat_bootstrap_v1'
    AND "bootstrap_route_attached_at" IS NULL
    AND "skipped_at" IS NULL;
