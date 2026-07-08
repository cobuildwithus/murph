-- Keep active vault-share cap checks and delivery fanout bounded to granted rows.
CREATE INDEX "hosted_vault_share_active_grantor_projection_idx"
  ON "hosted_vault_share"("grantor_member_id", "projection_kind")
  WHERE "status" = 'granted';

CREATE INDEX "hosted_vault_share_active_destination_projection_idx"
  ON "hosted_vault_share"("destination_member_id", "projection_kind")
  WHERE "status" = 'granted';
