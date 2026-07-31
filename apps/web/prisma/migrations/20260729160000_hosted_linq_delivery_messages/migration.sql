CREATE TABLE "hosted_linq_delivery_message" (
  "id" TEXT NOT NULL,
  "delivery_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "message_lookup_key" TEXT NOT NULL,
  "message_id_suffix" TEXT,
  "status" TEXT NOT NULL DEFAULT 'accepted',
  "accepted_at" TIMESTAMP(3) NOT NULL,
  "delivered_at" TIMESTAMP(3),
  "failed_at" TIMESTAMP(3),
  "last_receipt_at" TIMESTAMP(3),
  "last_provider_event_id" TEXT,
  "failure_code" TEXT,
  "failure_reason" TEXT,
  "service" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hosted_linq_delivery_message_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hosted_linq_delivery_message_message_lookup_key_key"
  ON "hosted_linq_delivery_message"("message_lookup_key");
CREATE UNIQUE INDEX "hosted_linq_delivery_message_delivery_id_ordinal_key"
  ON "hosted_linq_delivery_message"("delivery_id", "ordinal");
CREATE INDEX "hosted_linq_delivery_message_delivery_id_status_idx"
  ON "hosted_linq_delivery_message"("delivery_id", "status");
CREATE INDEX "hosted_linq_delivery_message_last_receipt_at_idx"
  ON "hosted_linq_delivery_message"("last_receipt_at");

ALTER TABLE "hosted_linq_delivery_message"
  ADD CONSTRAINT "hosted_linq_delivery_message_delivery_id_fkey"
  FOREIGN KEY ("delivery_id")
  REFERENCES "hosted_linq_delivery"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
