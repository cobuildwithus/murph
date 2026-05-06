ALTER TABLE "hosted_member_billing_ref"
  ADD COLUMN "stripe_subscription_schedule_lookup_key" TEXT,
  ADD COLUMN "stripe_subscription_schedule_id_encrypted" TEXT,
  ADD COLUMN "scheduled_billing_plan_code" TEXT,
  ADD COLUMN "scheduled_billing_effective_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "hosted_member_billing_ref_stripe_subscription_schedule_lookup_key_key"
  ON "hosted_member_billing_ref"("stripe_subscription_schedule_lookup_key");
