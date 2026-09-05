ALTER TABLE "hosted_linq_delivery_message"
  ADD COLUMN "terminal_retry_attempted_at" TIMESTAMP(3),
  ADD COLUMN "terminal_retry_original_message_lookup_key" TEXT;

CREATE UNIQUE INDEX "hosted_linq_delivery_message_terminal_retry_key"
  ON "hosted_linq_delivery_message" ("terminal_retry_original_message_lookup_key");
