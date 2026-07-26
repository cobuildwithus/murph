BEGIN;

-- Establish one cutover boundary. Fulfillment updates and account-deletion
-- deletes wait until the retained-row baseline and future-increment trigger
-- are both installed.
LOCK TABLE "hosted_usage_credit_purchase" IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE "hosted_growth_aggregate" (
  "id" VARCHAR(32) NOT NULL,
  "tracked_fulfilled_usage_top_ups" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "hosted_growth_aggregate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hosted_growth_aggregate_singleton"
    CHECK ("id" = 'global'),
  CONSTRAINT "hosted_growth_aggregate_tracked_top_ups_nonnegative"
    CHECK ("tracked_fulfilled_usage_top_ups" >= 0)
);

INSERT INTO "hosted_growth_aggregate" (
  "id",
  "tracked_fulfilled_usage_top_ups"
)
SELECT
  'global',
  COUNT(*)::INTEGER
FROM "hosted_usage_credit_purchase"
WHERE "status" = 'fulfilled';

-- Keep the count correct while warm pre-migration Web bundles drain. The
-- purchase status transition remains the one fulfillment authority, and this
-- trigger runs inside that same transaction.
CREATE FUNCTION increment_hosted_fulfilled_usage_top_ups()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "hosted_growth_aggregate"
  SET "tracked_fulfilled_usage_top_ups" =
    "tracked_fulfilled_usage_top_ups" + 1
  WHERE "id" = 'global';

  RETURN NEW;
END;
$$;

CREATE TRIGGER "hosted_usage_credit_purchase_growth_total"
AFTER UPDATE OF "status" ON "hosted_usage_credit_purchase"
FOR EACH ROW
WHEN (
  OLD."status" IS DISTINCT FROM 'fulfilled'
  AND NEW."status" = 'fulfilled'
)
EXECUTE FUNCTION increment_hosted_fulfilled_usage_top_ups();

COMMIT;
