ALTER TABLE "hosted_group_member"
  ADD COLUMN "join_confirmation_eligible_at" TIMESTAMP(3);

-- Keep first joins written by the warm prior deployment recoverable while it
-- cannot populate the new column. This bridge is removed by the matching
-- post-drain contract migration; it deliberately does not backfill history.
CREATE FUNCTION set_hosted_group_join_confirmation_eligibility()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."join_confirmation_eligible_at" IS NULL
    AND NEW."role" = 'member'
    AND EXISTS (
      SELECT 1
      FROM "hosted_group"
      WHERE "id" = NEW."group_id"
        AND "join_code" IS NOT NULL
    )
  THEN
    NEW."join_confirmation_eligible_at" = COALESCE(
      NEW."joined_at",
      CURRENT_TIMESTAMP
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "hosted_group_join_confirmation_eligibility_bridge"
BEFORE INSERT ON "hosted_group_member"
FOR EACH ROW
EXECUTE FUNCTION set_hosted_group_join_confirmation_eligibility();
