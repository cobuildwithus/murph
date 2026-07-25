-- Records which Pulse action a member asked for before they leave for Stripe's
-- payment-method page. Stripe's payment_method.attached event carries no intent
-- of its own, so without this the webhook cannot tell a start-now from a
-- continue-at-trial-end and would have to guess at charging someone.
ALTER TABLE "hosted_member_billing_ref"
  ADD COLUMN "pulse_trial_payment_intent_action" TEXT,
  ADD COLUMN "pulse_trial_payment_intent_expires_at" TIMESTAMP(3);
