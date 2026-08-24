CREATE TABLE "hosted_ops_usage_reset_receipt" (
  "operation_id" UUID NOT NULL,
  "member_id" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "reset_mode" TEXT,
  "runtime_recheck_required" BOOLEAN NOT NULL,
  "notice_claim_released" BOOLEAN NOT NULL DEFAULT FALSE,
  "period_start" TIMESTAMP(3),
  "previous_spent_usd_micros" BIGINT,
  "reset_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3),
  "usage_credit_granted_usd_micros" BIGINT NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "hosted_ops_usage_reset_receipt_pkey"
    PRIMARY KEY ("operation_id", "member_id"),
  CONSTRAINT "hosted_ops_usage_reset_receipt_member_id_fkey"
    FOREIGN KEY ("member_id")
    REFERENCES "hosted_member"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "hosted_ops_usage_reset_receipt_outcome_check"
    CHECK ("outcome" IN ('reset', 'skipped', 'unchanged')),
  CONSTRAINT "hosted_ops_usage_reset_receipt_reset_mode_check"
    CHECK (
      "reset_mode" IS NULL
      OR "reset_mode" IN ('included_usage', 'starter_allowance')
    ),
  CONSTRAINT "hosted_ops_usage_reset_receipt_credit_check"
    CHECK ("usage_credit_granted_usd_micros" >= 0)
);

CREATE INDEX "hosted_ops_usage_reset_receipt_member_created_idx"
  ON "hosted_ops_usage_reset_receipt"("member_id", "created_at");
