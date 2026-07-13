-- Accepted conversation replay must use the exact allowance-period identity
-- admitted at append time. Timestamps alone are ambiguous when periods overlap.
ALTER TABLE "hosted_mailbox_item"
  ADD COLUMN "accepted_allowance_period_start" TIMESTAMP(3);

-- This additive migration binds legacy nonterminal rows when exactly one
-- existing usage period contains their acceptance timestamp. The gated
-- rollout backfill handles provable zero-candidate rows after old writers
-- drain; multiple candidates remain NULL instead of guessing.
WITH unique_legacy_period AS (
  SELECT
    item."id" AS "mailbox_item_id",
    MIN(period."period_start") AS "period_start"
  FROM "hosted_mailbox_item" AS item
  LEFT JOIN "hosted_mailbox_lane_counter" AS counter
    ON counter."user_id" = item."user_id"
   AND counter."lane" = item."lane"
  INNER JOIN "hosted_ai_usage_period" AS period
    ON period."member_id" = item."user_id"
   AND period."period_start" <= item."created_at"
   AND period."period_end" > item."created_at"
  WHERE item."kind" = 'conversation.message'
    AND item."lane" = 'conversation'
    AND item."consumed_at" IS NULL
    AND COALESCE(counter."consumed_seq", 0) < item."lane_seq"
  GROUP BY item."id"
  HAVING COUNT(*) = 1
)
UPDATE "hosted_mailbox_item" AS item
SET "accepted_allowance_period_start" = candidate."period_start"
FROM unique_legacy_period AS candidate
WHERE item."id" = candidate."mailbox_item_id";
