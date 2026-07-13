ALTER TABLE "hosted_mailbox_item"
  ADD COLUMN "causal_seq" BIGINT;

CREATE UNIQUE INDEX "hosted_mailbox_item_user_id_causal_seq_key"
  ON "hosted_mailbox_item"("user_id", "causal_seq");
