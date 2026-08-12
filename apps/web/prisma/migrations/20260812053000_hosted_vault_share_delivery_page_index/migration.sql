CREATE INDEX CONCURRENTLY "hosted_vault_share_active_grantor_scope_id_idx"
  ON "hosted_vault_share"("grantor_member_id", "projection_scope_key", "id")
  WHERE "status" = 'granted';

DROP INDEX CONCURRENTLY "hosted_vault_share_active_grantor_scope_idx";
