ALTER TABLE "hosted_member_billing_ref"
  ADD COLUMN "current_billing_phase" TEXT,
  ADD COLUMN "current_checkout_offer" TEXT,
  ADD COLUMN "pulse_trial_redeemed_at" TIMESTAMP(3),
  ADD COLUMN "pulse_trial_policy_version" TEXT,
  ADD COLUMN "current_trial_started_at" TIMESTAMP(3),
  ADD COLUMN "current_trial_ends_at" TIMESTAMP(3);
