ALTER TABLE "hosted_vault_share"
  ADD COLUMN "projection_scope_key" TEXT,
  ADD COLUMN "projection_scope_json" JSONB;

UPDATE "hosted_vault_share"
SET
  "projection_scope_key" = "projection_kind",
  "projection_scope_json" = jsonb_build_object('projectionKind', "projection_kind")
WHERE "projection_scope_key" IS NULL;

CREATE OR REPLACE FUNCTION hosted_vault_share_projection_scope_compat()
RETURNS trigger AS $$
BEGIN
  IF NEW."projection_scope_key" IS NULL THEN
    NEW."projection_scope_key" := NEW."projection_kind";
  END IF;

  IF NEW."projection_scope_json" IS NULL THEN
    NEW."projection_scope_json" := jsonb_build_object('projectionKind', NEW."projection_kind");
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER hosted_vault_share_projection_scope_compat
  BEFORE INSERT OR UPDATE OF "projection_kind", "projection_scope_key", "projection_scope_json"
  ON "hosted_vault_share"
  FOR EACH ROW
  EXECUTE FUNCTION hosted_vault_share_projection_scope_compat();

ALTER TABLE "hosted_vault_share"
  ALTER COLUMN "projection_scope_key" SET NOT NULL;

DROP INDEX IF EXISTS "hosted_vault_share_grantor_member_id_projection_kind_desti_key";

CREATE UNIQUE INDEX "hosted_vault_share_grantor_scope_destination_key"
  ON "hosted_vault_share"("grantor_member_id", "projection_scope_key", "destination_member_id");

CREATE UNIQUE INDEX "hosted_vault_share_legacy_fixed_kind_destination_key"
  ON "hosted_vault_share"("grantor_member_id", "projection_kind", "destination_member_id")
  WHERE "projection_scope_key" = "projection_kind";

CREATE INDEX "hosted_vault_share_active_grantor_scope_idx"
  ON "hosted_vault_share"("grantor_member_id", "projection_scope_key")
  WHERE "status" = 'granted';

CREATE INDEX "hosted_vault_share_active_destination_scope_idx"
  ON "hosted_vault_share"("destination_member_id", "projection_scope_key")
  WHERE "status" = 'granted';
