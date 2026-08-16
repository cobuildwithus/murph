CREATE INDEX CONCURRENTLY "hosted_mailbox_member_activation_occurred_idx"
  ON "hosted_mailbox_item"("occurred_at", "user_id", "id")
  WHERE "kind" = 'member.activated';

CREATE INDEX CONCURRENTLY "hosted_mailbox_preference_handoff_user_lane_idx"
  ON "hosted_mailbox_item"("user_id", "lane_seq")
  INCLUDE ("id", "created_at", "expires_at", "lane")
  WHERE "kind" = 'member.preferences.updated';

CREATE INDEX CONCURRENTLY "hosted_mailbox_vault_refresh_user_lane_idx"
  ON "hosted_mailbox_item"("user_id", "lane_seq")
  INCLUDE ("id", "created_at", "expires_at", "lane")
  WHERE "kind" = 'runtime.browser-vault-refresh-requested';

CREATE INDEX CONCURRENTLY "hosted_usage_referral_queued_recovery_idx"
  ON "hosted_usage_referral"(
    "celebration_queued_at",
    "beneficiary_member_id",
    "id"
  )
  WHERE "status" = 'rewarded'
    AND "celebration_queued_at" IS NOT NULL;
