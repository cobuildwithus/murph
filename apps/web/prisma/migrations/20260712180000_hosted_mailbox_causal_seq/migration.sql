ALTER TABLE "hosted_mailbox_item"
  ADD COLUMN "causal_seq" BIGINT;

ALTER TABLE "hosted_mailbox_item"
  ADD CONSTRAINT "hosted_mailbox_item_preferences_causal_seq_check"
  CHECK (
    "kind" <> 'member.preferences.updated'
    OR "causal_seq" IS DISTINCT FROM NULL
    OR "consumed_at" IS NOT NULL
  );

CREATE UNIQUE INDEX "hosted_mailbox_item_user_id_causal_seq_key"
  ON "hosted_mailbox_item"("user_id", "causal_seq");
