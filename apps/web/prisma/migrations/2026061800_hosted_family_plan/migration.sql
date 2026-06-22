-- Hosted Family plan MVP: account groups, memberships, invites, and group billing refs.

CREATE TABLE "hosted_account_group" (
    "id" TEXT NOT NULL,
    "display_name" TEXT,
    "owner_member_id" TEXT NOT NULL,
    "billing_status" "HostedBillingStatus" NOT NULL DEFAULT 'not_started',
    "suspended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_account_group_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hosted_account_group_membership" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "joined_at" TIMESTAMP(3),
    "removed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_account_group_membership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hosted_account_group_invite" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "invite_code" TEXT NOT NULL,
    "invited_by_member_id" TEXT NOT NULL,
    "accepted_by_member_id" TEXT,
    "target_label" TEXT,
    "target_phone_lookup_key" TEXT,
    "target_phone_number_encrypted" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'family',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "accepted_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_account_group_invite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hosted_account_group_billing_ref" (
    "group_id" TEXT NOT NULL,
    "stripe_customer_lookup_key" TEXT,
    "stripe_customer_id_encrypted" TEXT,
    "stripe_subscription_lookup_key" TEXT,
    "stripe_subscription_id_encrypted" TEXT,
    "current_billing_plan_code" TEXT,
    "current_billing_phase" TEXT,
    "current_period_start" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "last_stripe_event_created_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "hosted_account_group_membership_group_id_member_id_key" ON "hosted_account_group_membership"("group_id", "member_id");
CREATE UNIQUE INDEX "hosted_account_group_invite_invite_code_key" ON "hosted_account_group_invite"("invite_code");
CREATE UNIQUE INDEX "hosted_account_group_billing_ref_group_id_key" ON "hosted_account_group_billing_ref"("group_id");
CREATE UNIQUE INDEX "hosted_account_group_billing_ref_stripe_customer_lookup_key_key" ON "hosted_account_group_billing_ref"("stripe_customer_lookup_key");
CREATE UNIQUE INDEX "hosted_account_group_billing_ref_stripe_subscription_lookup_key_key" ON "hosted_account_group_billing_ref"("stripe_subscription_lookup_key");
CREATE UNIQUE INDEX "hosted_account_group_owner_member_id_key" ON "hosted_account_group"("owner_member_id");

CREATE INDEX "hosted_account_group_billing_status_idx" ON "hosted_account_group"("billing_status");
CREATE INDEX "hosted_account_group_membership_member_id_status_idx" ON "hosted_account_group_membership"("member_id", "status");
CREATE INDEX "hosted_account_group_membership_group_id_status_idx" ON "hosted_account_group_membership"("group_id", "status");
CREATE INDEX "hosted_account_group_invite_group_id_status_created_at_idx" ON "hosted_account_group_invite"("group_id", "status", "created_at");
CREATE INDEX "hosted_account_group_invite_target_phone_lookup_key_idx" ON "hosted_account_group_invite"("target_phone_lookup_key");
CREATE INDEX "hosted_account_group_invite_accepted_by_member_id_idx" ON "hosted_account_group_invite"("accepted_by_member_id");
CREATE INDEX "hosted_account_group_invite_expires_at_idx" ON "hosted_account_group_invite"("expires_at");

ALTER TABLE "hosted_account_group" ADD CONSTRAINT "hosted_account_group_owner_member_id_fkey" FOREIGN KEY ("owner_member_id") REFERENCES "hosted_member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hosted_account_group_membership" ADD CONSTRAINT "hosted_account_group_membership_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "hosted_account_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hosted_account_group_membership" ADD CONSTRAINT "hosted_account_group_membership_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hosted_account_group_invite" ADD CONSTRAINT "hosted_account_group_invite_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "hosted_account_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hosted_account_group_invite" ADD CONSTRAINT "hosted_account_group_invite_invited_by_member_id_fkey" FOREIGN KEY ("invited_by_member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hosted_account_group_invite" ADD CONSTRAINT "hosted_account_group_invite_accepted_by_member_id_fkey" FOREIGN KEY ("accepted_by_member_id") REFERENCES "hosted_member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hosted_account_group_billing_ref" ADD CONSTRAINT "hosted_account_group_billing_ref_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "hosted_account_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
