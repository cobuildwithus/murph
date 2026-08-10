ALTER TABLE "hosted_usage_credit_purchase"
  DROP CONSTRAINT IF EXISTS "hosted_usage_credit_purchase_active_payer_required",
  ADD CONSTRAINT "hosted_usage_credit_purchase_active_payer_required"
    CHECK (
      (
        "payer_member_id" IS NOT NULL
        AND "stripe_price_id_encrypted" IS NOT NULL
        AND "stripe_customer_id_encrypted" IS NOT NULL
      )
      OR (
        "payer_member_id" IS NULL
        AND "status" = 'expired'
        AND "terminal_at" IS NOT NULL
        AND "last_reconciled_at" IS NOT NULL
      )
      OR (
        "payer_member_id" IS NULL
        AND "status" = 'payment_failed'
        AND "terminal_at" IS NOT NULL
        AND "last_reconciled_at" IS NOT NULL
        AND (
          "stripe_checkout_session_lookup_key" IS NOT NULL
          OR (
            "group_sponsorship_authorization_id" IS NOT NULL
            AND "group_sponsorship_charge_ordinal" > 0
            AND "stripe_checkout_session_lookup_key" IS NULL
            AND "stripe_payment_intent_lookup_key" IS NULL
            AND "stripe_charge_lookup_key" IS NULL
          )
        )
      )
      OR (
        "payer_member_id" IS NULL
        AND "status" = 'fulfilled'
        AND "terminal_at" IS NOT NULL
        AND "last_reconciled_at" IS NOT NULL
        AND "paid_at" IS NOT NULL
        AND "stripe_payment_intent_lookup_key" IS NOT NULL
        AND "stripe_charge_lookup_key" IS NOT NULL
      )
    ) NOT VALID;

ALTER TABLE "hosted_usage_credit_purchase"
  VALIDATE CONSTRAINT "hosted_usage_credit_purchase_active_payer_required";
