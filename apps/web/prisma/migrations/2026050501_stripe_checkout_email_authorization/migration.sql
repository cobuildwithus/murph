-- Store the email address Stripe collected during checkout as an encrypted,
-- unverified settings hint and transactional welcome-email recipient.
ALTER TABLE "hosted_member_email_authorization"
  ADD COLUMN "stripe_checkout_email_address_encrypted" TEXT,
  ADD COLUMN "stripe_checkout_email_collected_at" TIMESTAMP(3);
