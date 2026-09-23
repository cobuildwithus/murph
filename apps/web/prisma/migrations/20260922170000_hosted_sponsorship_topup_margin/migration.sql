-- Expand before deploying the reduced-grant catalog. Historical purchases
-- retain their frozen grants; keep both values allowed during rollback.
ALTER TABLE "hosted_usage_credit_purchase"
  DROP CONSTRAINT "hosted_usage_credit_purchase_sponsorship_shape_valid",
  ADD CONSTRAINT "hosted_usage_credit_purchase_sponsorship_shape_valid"
    CHECK (
      (
        "group_sponsorship_authorization_id" IS NULL
        AND "group_sponsorship_period_started_at" IS NULL
        AND "group_sponsorship_charge_ordinal" IS NULL
      )
      OR (
        "group_sponsorship_authorization_id" IS NOT NULL
        AND "group_sponsorship_period_started_at" IS NOT NULL
        AND "group_sponsorship_charge_ordinal" IS NOT NULL
        AND "group_sponsorship_charge_ordinal" >= 0
        AND "offer_code" = 'usage_5_usd'
        AND "cash_currency" = 'usd'
        AND "cash_amount_minor" = 500
        AND "grant_usd_micros" IN (4000000, 5000000)
      )
    ) NOT VALID;

ALTER TABLE "hosted_usage_credit_purchase"
  VALIDATE CONSTRAINT "hosted_usage_credit_purchase_sponsorship_shape_valid";
