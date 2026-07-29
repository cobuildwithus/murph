ALTER TABLE "hosted_mailbox_item"
  ADD COLUMN "source_message_lookup_key" TEXT;

CREATE INDEX "hosted_mailbox_item_source_message_lookup_key_causal_seq_idx"
  ON "hosted_mailbox_item"("source_message_lookup_key", "causal_seq");
