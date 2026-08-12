CREATE INDEX CONCURRENTLY "hosted_vault_share_active_grantor_scope_destination_idx"
  ON "hosted_vault_share"("grantor_member_id", "projection_scope_key", "destination_member_id")
  WHERE "status" = 'granted';
