CREATE TYPE "HostedGroupSponsorshipAuthorizationStatus" AS ENUM (
  'pending_activation',
  'active',
  'paused',
  'recovery_required',
  'canceled'
);

CREATE TABLE "hosted_group_sponsorship_authorization" (
  "id" TEXT NOT NULL,
  "payer_member_id" TEXT,
  "beneficiary_member_id" TEXT NOT NULL,
  "status" "HostedGroupSponsorshipAuthorizationStatus" NOT NULL DEFAULT 'pending_activation',
  "monthly_cap_minor" INTEGER NOT NULL,
  "pending_monthly_cap_minor" INTEGER,
  "period_started_at" TIMESTAMP(3) NOT NULL,
  "period_ends_at" TIMESTAMP(3) NOT NULL,
  "anchor_day" INTEGER NOT NULL,
  "anchor_end_of_month" BOOLEAN NOT NULL,
  "recovery_started_at" TIMESTAMP(3),
  "canceled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hosted_group_sponsorship_authorization_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hosted_group_sponsorship_authorization_cap_valid"
    CHECK (
      "monthly_cap_minor" IN (500, 1000, 2000)
      AND (
        "pending_monthly_cap_minor" IS NULL
        OR "pending_monthly_cap_minor" IN (500, 1000, 2000)
      )
    ),
  CONSTRAINT "hosted_group_sponsorship_authorization_period_valid"
    CHECK (
      "period_ends_at" > "period_started_at"
      AND "anchor_day" BETWEEN 1 AND 31
    ),
  CONSTRAINT "hosted_group_sponsorship_authorization_live_payer_required"
    CHECK (
      ("status" = 'canceled' AND "canceled_at" IS NOT NULL)
      OR (
        "status" <> 'canceled'
        AND "payer_member_id" IS NOT NULL
        AND "canceled_at" IS NULL
      )
    ),
  CONSTRAINT "hosted_group_sponsorship_authorization_recovery_shape_valid"
    CHECK (
      ("status" = 'recovery_required') =
      ("recovery_started_at" IS NOT NULL)
    ),
  CONSTRAINT "hosted_group_sponsorship_authorization_payer_member_id_fkey"
    FOREIGN KEY ("payer_member_id") REFERENCES "hosted_member"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "hosted_group_sponsorship_authorization_beneficiary_member_id_fkey"
    FOREIGN KEY ("beneficiary_member_id") REFERENCES "hosted_member"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "hosted_group_sponsorship_authorization_live_beneficiary_key"
  ON "hosted_group_sponsorship_authorization"("beneficiary_member_id")
  WHERE "status" IN ('pending_activation', 'active', 'paused', 'recovery_required');

CREATE INDEX "hosted_group_sponsorship_authorization_payer_status_idx"
  ON "hosted_group_sponsorship_authorization"("payer_member_id", "status", "updated_at");

CREATE INDEX "hosted_group_sponsorship_authorization_beneficiary_status_idx"
  ON "hosted_group_sponsorship_authorization"("beneficiary_member_id", "status", "updated_at");

ALTER TABLE "hosted_usage_credit_purchase"
  ADD COLUMN "group_sponsorship_authorization_id" TEXT,
  ADD COLUMN "group_sponsorship_period_started_at" TIMESTAMP(3),
  ADD COLUMN "group_sponsorship_charge_ordinal" INTEGER;

ALTER TABLE "hosted_usage_credit_purchase"
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
        AND "grant_usd_micros" = 5000000
      )
    ) NOT VALID,
  ADD CONSTRAINT "hosted_usage_credit_purchase_group_sponsorship_authorization_id_fkey"
    FOREIGN KEY ("group_sponsorship_authorization_id")
    REFERENCES "hosted_group_sponsorship_authorization"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hosted_usage_credit_purchase"
  VALIDATE CONSTRAINT "hosted_usage_credit_purchase_sponsorship_shape_valid";

CREATE UNIQUE INDEX "hosted_usage_credit_purchase_sponsorship_period_ordinal_key"
  ON "hosted_usage_credit_purchase"(
    "group_sponsorship_authorization_id",
    "group_sponsorship_period_started_at",
    "group_sponsorship_charge_ordinal"
  );

CREATE INDEX "hosted_usage_credit_purchase_sponsorship_period_status_idx"
  ON "hosted_usage_credit_purchase"(
    "group_sponsorship_authorization_id",
    "group_sponsorship_period_started_at",
    "status"
  );

CREATE UNIQUE INDEX "hosted_usage_credit_purchase_active_payer_v2_key"
  ON "hosted_usage_credit_purchase"("payer_member_id")
  WHERE "status" IN ('created', 'checkout_open', 'payment_pending')
    AND (
      "group_sponsorship_authorization_id" IS NULL
      OR "group_sponsorship_charge_ordinal" = 0
    );

DROP INDEX "hosted_usage_credit_purchase_active_payer_key";

CREATE INDEX "hosted_usage_credit_purchase_sponsorship_refill_dispatch_idx"
  ON "hosted_usage_credit_purchase"(
    "last_reconciled_at" ASC NULLS FIRST,
    "created_at" ASC,
    "id" ASC
  )
  WHERE "group_sponsorship_charge_ordinal" > 0
    AND "status" IN ('created', 'payment_pending', 'payment_failed');
