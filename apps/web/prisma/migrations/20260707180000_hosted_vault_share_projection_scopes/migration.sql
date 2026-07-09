ALTER TABLE "hosted_vault_share"
  ADD COLUMN "projection_scope_key" TEXT,
  ADD COLUMN "projection_scope_json" JSONB;

UPDATE "hosted_vault_share"
SET
  "projection_scope_key" = "projection_kind",
  "projection_scope_json" = jsonb_build_object('projectionKind', "projection_kind")
WHERE "projection_scope_key" IS NULL;

ALTER TABLE "hosted_vault_share"
  ALTER COLUMN "projection_scope_key" SET NOT NULL;

DROP INDEX IF EXISTS "hosted_vault_share_grantor_member_id_projection_kind_desti_key";
DROP INDEX IF EXISTS "hosted_vault_share_active_grantor_projection_idx";
DROP INDEX IF EXISTS "hosted_vault_share_active_destination_projection_idx";

CREATE UNIQUE INDEX "hosted_vault_share_grantor_scope_destination_key"
  ON "hosted_vault_share"("grantor_member_id", "projection_scope_key", "destination_member_id");

CREATE INDEX "hosted_vault_share_active_grantor_scope_idx"
  ON "hosted_vault_share"("grantor_member_id", "projection_scope_key")
  WHERE "status" = 'granted';

CREATE INDEX "hosted_vault_share_active_destination_scope_idx"
  ON "hosted_vault_share"("destination_member_id", "projection_scope_key")
  WHERE "status" = 'granted';
