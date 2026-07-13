ALTER TABLE "hosted_mailbox_item"
  ADD CONSTRAINT "hosted_mailbox_item_preferences_causal_seq_check"
  CHECK (
    "kind" <> 'member.preferences.updated'
    OR "causal_seq" IS NOT NULL
    OR "consumed_at" IS NOT NULL
  );
