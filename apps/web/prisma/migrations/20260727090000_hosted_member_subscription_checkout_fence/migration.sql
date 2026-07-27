ALTER TABLE "hosted_member_billing_ref"
  ADD COLUMN "stripe_checkout_session_lookup_key" TEXT,
  ADD COLUMN "stripe_checkout_session_id_encrypted" TEXT;

CREATE UNIQUE INDEX "hosted_member_billing_ref_stripe_checkout_session_lookup_key_key"
  ON "hosted_member_billing_ref"("stripe_checkout_session_lookup_key");
