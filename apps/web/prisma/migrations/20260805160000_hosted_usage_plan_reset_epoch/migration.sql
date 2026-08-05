ALTER TABLE "hosted_ai_usage_period"
  ADD COLUMN "highest_billing_plan_code" TEXT,
  ADD COLUMN "plan_reset_at" TIMESTAMP(3);
