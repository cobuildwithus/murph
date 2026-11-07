ALTER TABLE "hosted_linq_delivery_message"
  ADD COLUMN "terminal_retry_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "terminal_retry_next_at" TIMESTAMP(3),
  ADD COLUMN "terminal_retry_expires_at" TIMESTAMP(3),
  ADD COLUMN "terminal_retry_claimed_message_lookup_key" TEXT,
  ADD COLUMN "terminal_retry_previous_message_lookup_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "terminal_retry_context_ciphertext" TEXT,
  ADD COLUMN "terminal_retry_owner_member_id" TEXT;

CREATE INDEX "hosted_linq_delivery_message_terminal_retry_history_idx"
  ON "hosted_linq_delivery_message" USING GIN ("terminal_retry_previous_message_lookup_keys");

CREATE INDEX "hosted_linq_delivery_chat_accepted_at_idx"
  ON "hosted_linq_delivery" ("linq_chat_lookup_key", "accepted_at");
