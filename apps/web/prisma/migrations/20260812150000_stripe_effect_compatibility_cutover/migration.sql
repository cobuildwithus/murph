ALTER TABLE "hosted_member_billing_ref"
  ADD COLUMN "stripe_effect_claim_id" TEXT,
  ADD COLUMN "stripe_effect_kind" TEXT,
  ADD COLUMN "stripe_effect_target_plan_code" TEXT,
  ADD COLUMN "stripe_effect_claimed_at" TIMESTAMP(3),
  ADD COLUMN "stripe_effect_execution_id" TEXT,
  ADD COLUMN "stripe_effect_execution_started_at" TIMESTAMP(3);

ALTER TABLE "hosted_account_group_billing_ref"
  ADD COLUMN "stripe_effect_claim_id" TEXT,
  ADD COLUMN "stripe_effect_kind" TEXT,
  ADD COLUMN "stripe_effect_source_pulse_seats" INTEGER,
  ADD COLUMN "stripe_effect_source_edge_seats" INTEGER,
  ADD COLUMN "stripe_effect_source_max_seats" INTEGER,
  ADD COLUMN "stripe_effect_target_pulse_seats" INTEGER,
  ADD COLUMN "stripe_effect_target_edge_seats" INTEGER,
  ADD COLUMN "stripe_effect_target_max_seats" INTEGER,
  ADD COLUMN "stripe_effect_beneficiary_member_id" TEXT,
  ADD COLUMN "stripe_effect_family_subscription_lookup_key" TEXT,
  ADD COLUMN "stripe_effect_direct_subscription_lookup_key" TEXT,
  ADD COLUMN "stripe_effect_claimed_at" TIMESTAMP(3),
  ADD COLUMN "stripe_effect_execution_id" TEXT,
  ADD COLUMN "stripe_effect_execution_started_at" TIMESTAMP(3);
