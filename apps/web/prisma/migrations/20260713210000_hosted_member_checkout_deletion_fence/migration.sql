ALTER TABLE "hosted_member_billing_ref"
ADD COLUMN "checkout_attempt_id" TEXT,
ADD COLUMN "stripe_checkout_session_lookup_key" TEXT,
ADD COLUMN "stripe_checkout_session_id_encrypted" TEXT;

CREATE UNIQUE INDEX "hosted_member_billing_ref_stripe_checkout_session_lookup_key_key"
ON "hosted_member_billing_ref"("stripe_checkout_session_lookup_key");

ALTER TABLE "hosted_stripe_event"
ADD COLUMN "pulse_trial_cleanup_accepted_at" TIMESTAMP(3),
ADD COLUMN "pulse_trial_cleanup_encryption_member_id" TEXT,
ADD COLUMN "pulse_trial_cleanup_subscription_id_encrypted" TEXT;

CREATE INDEX "hosted_stripe_event_pulse_cleanup_member"
ON "hosted_stripe_event"("pulse_trial_cleanup_encryption_member_id");
