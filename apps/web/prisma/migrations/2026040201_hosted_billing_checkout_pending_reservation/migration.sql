ALTER TYPE "HostedBillingCheckoutStatus" ADD VALUE IF NOT EXISTS 'pending';

ALTER TABLE "hosted_billing_checkout"
  ALTER COLUMN "stripe_checkout_session_id" DROP NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'pending';

DROP INDEX IF EXISTS "hosted_billing_checkout_member_open_unique";
DROP INDEX IF EXISTS "hosted_billing_checkout_invite_open_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "hosted_billing_checkout_member_active_unique"
  ON "hosted_billing_checkout"("member_id")
  WHERE "status" IN ('pending', 'open');

CREATE UNIQUE INDEX IF NOT EXISTS "hosted_billing_checkout_invite_active_unique"
  ON "hosted_billing_checkout"("invite_id")
  WHERE "invite_id" IS NOT NULL AND "status" IN ('pending', 'open');
