CREATE TYPE "HostedUsageCreditCheckoutCreateState" AS ENUM (
  'not_started',
  'claimed',
  'attached',
  'closed'
);

CREATE TYPE "HostedUsageCreditPurchaseStatus" AS ENUM (
  'created',
  'checkout_open',
  'payment_pending',
  'fulfilled',
  'expired',
  'payment_failed'
);

CREATE TYPE "HostedUsageCreditEntryKind" AS ENUM (
  'purchase_grant',
  'usage_debit',
  'refund_reversal',
  'dispute_reversal',
  'reversal_restoration'
);

CREATE TABLE "hosted_usage_credit_purchase" (
  "id" TEXT NOT NULL,
  "payer_member_id" TEXT NOT NULL,
  "beneficiary_member_id" TEXT NOT NULL,
  "authorization_context" TEXT NOT NULL,
  "offer_code" TEXT NOT NULL,
  "cash_currency" TEXT NOT NULL,
  "cash_amount_minor" INTEGER NOT NULL,
  "grant_usd_micros" BIGINT NOT NULL,
  "remaining_credit_usd_micros" BIGINT NOT NULL DEFAULT 0,
  "conversion_policy_version" TEXT NOT NULL,
  "client_request_key" TEXT NOT NULL,
  "request_fingerprint" TEXT NOT NULL,
  "checkout_request_policy_version" TEXT NOT NULL,
  "checkout_create_state" "HostedUsageCreditCheckoutCreateState" NOT NULL DEFAULT 'not_started',
  "status" "HostedUsageCreditPurchaseStatus" NOT NULL DEFAULT 'created',
  "stripe_live_mode" BOOLEAN NOT NULL,
  "stripe_price_lookup_key" TEXT NOT NULL,
  "stripe_price_id_encrypted" TEXT NOT NULL,
  "stripe_customer_lookup_key" TEXT NOT NULL,
  "stripe_customer_id_encrypted" TEXT NOT NULL,
  "stripe_checkout_session_lookup_key" TEXT,
  "stripe_checkout_session_id_encrypted" TEXT,
  "stripe_checkout_url_encrypted" TEXT,
  "stripe_payment_intent_lookup_key" TEXT,
  "stripe_payment_intent_id_encrypted" TEXT,
  "stripe_charge_lookup_key" TEXT,
  "stripe_charge_id_encrypted" TEXT,
  "checkout_client_reference_id" TEXT NOT NULL,
  "checkout_success_url" TEXT NOT NULL,
  "checkout_cancel_url" TEXT NOT NULL,
  "checkout_metadata_json" JSONB NOT NULL,
  "checkout_request_digest" TEXT NOT NULL,
  "checkout_create_retry_cutoff_at" TIMESTAMP(3) NOT NULL,
  "checkout_expires_at" TIMESTAMP(3) NOT NULL,
  "paid_at" TIMESTAMP(3),
  "fulfilled_at" TIMESTAMP(3),
  "terminal_at" TIMESTAMP(3),
  "last_reconciled_at" TIMESTAMP(3),
  "reconciliation_version" BIGINT NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hosted_usage_credit_purchase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hosted_usage_credit_purchase_cash_positive"
    CHECK ("cash_amount_minor" > 0),
  CONSTRAINT "hosted_usage_credit_purchase_grant_positive"
    CHECK ("grant_usd_micros" > 0),
  CONSTRAINT "hosted_usage_credit_purchase_remaining_valid"
    CHECK (
      "remaining_credit_usd_micros" >= 0
      AND "remaining_credit_usd_micros" <= "grant_usd_micros"
    ),
  CONSTRAINT "hosted_usage_credit_purchase_checkout_window_valid"
    CHECK ("checkout_create_retry_cutoff_at" < "checkout_expires_at"),
  CONSTRAINT "hosted_usage_credit_purchase_reconciliation_version_nonnegative"
    CHECK ("reconciliation_version" >= 0),
  CONSTRAINT "hosted_usage_credit_purchase_payer_member_id_fkey"
    FOREIGN KEY ("payer_member_id") REFERENCES "hosted_member"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "hosted_usage_credit_purchase_beneficiary_member_id_fkey"
    FOREIGN KEY ("beneficiary_member_id") REFERENCES "hosted_member"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "hosted_usage_credit_entry" (
  "id" TEXT NOT NULL,
  "beneficiary_member_id" TEXT NOT NULL,
  "beneficiary_sequence" BIGINT NOT NULL,
  "kind" "HostedUsageCreditEntryKind" NOT NULL,
  "amount_usd_micros" BIGINT NOT NULL,
  "effective_at" TIMESTAMP(3) NOT NULL,
  "semantic_source_key" TEXT NOT NULL,
  "purchase_id" TEXT NOT NULL,
  "parent_grant_entry_id" TEXT,
  "source_usage_id" TEXT,
  "source_reference_lookup_key" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "hosted_usage_credit_entry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hosted_usage_credit_entry_amount_direction_valid"
    CHECK (
      ("kind" IN ('purchase_grant', 'reversal_restoration') AND "amount_usd_micros" > 0)
      OR
      ("kind" IN ('usage_debit', 'refund_reversal', 'dispute_reversal') AND "amount_usd_micros" < 0)
    ),
  CONSTRAINT "hosted_usage_credit_entry_source_shape_valid"
    CHECK (
      (
        "kind" = 'purchase_grant'
        AND "parent_grant_entry_id" IS NULL
        AND "source_usage_id" IS NULL
      )
      OR
      (
        "kind" = 'usage_debit'
        AND "parent_grant_entry_id" IS NOT NULL
        AND "source_usage_id" IS NOT NULL
      )
      OR
      (
        "kind" IN ('refund_reversal', 'dispute_reversal', 'reversal_restoration')
        AND "parent_grant_entry_id" IS NOT NULL
        AND "source_usage_id" IS NULL
        AND "source_reference_lookup_key" IS NOT NULL
      )
    ),
  CONSTRAINT "hosted_usage_credit_entry_beneficiary_member_id_fkey"
    FOREIGN KEY ("beneficiary_member_id") REFERENCES "hosted_member"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "hosted_usage_credit_entry_purchase_id_fkey"
    FOREIGN KEY ("purchase_id") REFERENCES "hosted_usage_credit_purchase"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "hosted_usage_credit_entry_parent_grant_entry_id_fkey"
    FOREIGN KEY ("parent_grant_entry_id") REFERENCES "hosted_usage_credit_entry"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "hosted_usage_credit_purchase_session_lookup_key"
  ON "hosted_usage_credit_purchase"("stripe_checkout_session_lookup_key");

CREATE UNIQUE INDEX "hosted_usage_credit_purchase_payment_intent_lookup_key"
  ON "hosted_usage_credit_purchase"("stripe_payment_intent_lookup_key");

CREATE UNIQUE INDEX "hosted_usage_credit_purchase_charge_lookup_key"
  ON "hosted_usage_credit_purchase"("stripe_charge_lookup_key");

CREATE UNIQUE INDEX "hosted_usage_credit_purchase_payer_request_key"
  ON "hosted_usage_credit_purchase"("payer_member_id", "client_request_key");

CREATE UNIQUE INDEX "hosted_usage_credit_purchase_active_payer_key"
  ON "hosted_usage_credit_purchase"("payer_member_id")
  WHERE "status" IN ('created', 'checkout_open', 'payment_pending')
    OR "checkout_create_state" = 'claimed';

CREATE INDEX "hosted_usage_credit_purchase_payer_status_idx"
  ON "hosted_usage_credit_purchase"("payer_member_id", "status", "created_at");

CREATE INDEX "hosted_usage_credit_purchase_beneficiary_status_idx"
  ON "hosted_usage_credit_purchase"("beneficiary_member_id", "status", "created_at");

CREATE INDEX "hosted_usage_credit_purchase_create_retry_idx"
  ON "hosted_usage_credit_purchase"("checkout_create_state", "checkout_create_retry_cutoff_at");

CREATE INDEX "hosted_usage_credit_purchase_price_lookup_idx"
  ON "hosted_usage_credit_purchase"("stripe_price_lookup_key");

CREATE INDEX "hosted_usage_credit_purchase_customer_lookup_idx"
  ON "hosted_usage_credit_purchase"("stripe_customer_lookup_key");

CREATE UNIQUE INDEX "hosted_usage_credit_entry_semantic_source_key"
  ON "hosted_usage_credit_entry"("semantic_source_key");

CREATE UNIQUE INDEX "hosted_usage_credit_entry_beneficiary_sequence_key"
  ON "hosted_usage_credit_entry"("beneficiary_member_id", "beneficiary_sequence");

CREATE UNIQUE INDEX "hosted_usage_credit_entry_usage_grant_key"
  ON "hosted_usage_credit_entry"("source_usage_id", "parent_grant_entry_id");

CREATE UNIQUE INDEX "hosted_usage_credit_entry_purchase_grant_key"
  ON "hosted_usage_credit_entry"("purchase_id")
  WHERE "kind" = 'purchase_grant';

CREATE INDEX "hosted_usage_credit_entry_beneficiary_kind_idx"
  ON "hosted_usage_credit_entry"("beneficiary_member_id", "kind", "beneficiary_sequence");

CREATE INDEX "hosted_usage_credit_entry_purchase_sequence_idx"
  ON "hosted_usage_credit_entry"("purchase_id", "beneficiary_sequence");

CREATE INDEX "hosted_usage_credit_entry_parent_grant_idx"
  ON "hosted_usage_credit_entry"("parent_grant_entry_id");

CREATE INDEX "hosted_usage_credit_entry_source_reference_idx"
  ON "hosted_usage_credit_entry"("source_reference_lookup_key");

ALTER TABLE "hosted_member"
  ADD COLUMN "usage_credit_balance_usd_micros" BIGINT DEFAULT 0
    CONSTRAINT "hosted_member_usage_credit_balance_nonnegative"
    CHECK ("usage_credit_balance_usd_micros" >= 0),
  ADD COLUMN "usage_credit_ledger_version" BIGINT DEFAULT 0
    CONSTRAINT "hosted_member_usage_credit_version_nonnegative"
    CHECK ("usage_credit_ledger_version" >= 0);
