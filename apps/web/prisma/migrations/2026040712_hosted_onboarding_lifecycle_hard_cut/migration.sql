-- hosted onboarding lifecycle hard cut:
-- - HostedMember keeps only billing entitlement plus suspension admin state.
-- - HostedInvite becomes metadata-only.
-- - HostedBillingCheckout stays as the operational checkout-attempt log.

ALTER TABLE "hosted_member"
  ADD COLUMN "suspended_at" TIMESTAMP(3);

UPDATE "hosted_member"
SET "suspended_at" = "updated_at"
WHERE "status" = 'suspended';

CREATE TYPE "HostedBillingStatus_new" AS ENUM (
  'not_started',
  'active',
  'incomplete',
  'past_due',
  'canceled',
  'unpaid',
  'paused'
);

ALTER TABLE "hosted_member"
  ALTER COLUMN "billing_status" DROP DEFAULT;

ALTER TABLE "hosted_member"
  ALTER COLUMN "billing_status" TYPE "HostedBillingStatus_new"
  USING (
    CASE
      WHEN "billing_status"::text = 'checkout_open' THEN 'not_started'::"HostedBillingStatus_new"
      ELSE "billing_status"::text::"HostedBillingStatus_new"
    END
  );

ALTER TABLE "hosted_member"
  ALTER COLUMN "billing_status" SET DEFAULT 'not_started';

DROP INDEX IF EXISTS "hosted_member_status_idx";

ALTER TABLE "hosted_member"
  DROP COLUMN "status",
  DROP COLUMN "billing_mode";

ALTER TABLE "hosted_invite"
  DROP COLUMN "status",
  DROP COLUMN "opened_at",
  DROP COLUMN "authenticated_at",
  DROP COLUMN "paid_at";

ALTER TABLE "hosted_billing_checkout"
  DROP COLUMN "mode";

DROP TYPE "HostedMemberStatus";
DROP TYPE "HostedInviteStatus";
DROP TYPE "HostedBillingMode";
DROP TYPE "HostedBillingStatus";
ALTER TYPE "HostedBillingStatus_new" RENAME TO "HostedBillingStatus";
