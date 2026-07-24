CREATE TYPE "HostedAccountExitReasonCode" AS ENUM (
  'too_expensive',
  'not_useful_enough',
  'too_many_texts',
  'privacy_concerns',
  'setup_trouble',
  'just_testing'
);

-- No member_id column and no foreign key by design: this row must survive the
-- account-deletion cascade that removes every member-keyed record, and must not
-- be joinable back to the person who left.
CREATE TABLE "hosted_account_exit_reason" (
  "id" TEXT NOT NULL,
  "reason" "HostedAccountExitReasonCode" NOT NULL,
  "note" TEXT,
  "billing_status" "HostedBillingStatus" NOT NULL,
  "tenure_days" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "hosted_account_exit_reason_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hosted_account_exit_reason_tenure_days_nonnegative"
    CHECK ("tenure_days" >= 0)
);

CREATE INDEX "hosted_account_exit_reason_created_at_idx"
  ON "hosted_account_exit_reason"("created_at");
