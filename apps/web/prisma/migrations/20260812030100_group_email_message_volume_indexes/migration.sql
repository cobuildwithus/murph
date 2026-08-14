CREATE INDEX CONCURRENTLY "hosted_group_member_group_created_id_idx"
  ON "hosted_group_member"("group_id", "created_at", "id");

CREATE INDEX CONCURRENTLY "hosted_vault_share_group_email_grants_idx"
  ON "hosted_vault_share"(
    "grantor_member_id",
    "destination_member_id",
    "projection_scope_key",
    "id"
  )
  WHERE "status" = 'granted';

CREATE INDEX CONCURRENTLY "hosted_mailbox_message_volume_occurred_idx"
  ON "hosted_mailbox_item"("occurred_at")
  WHERE "kind" = 'conversation.message';
