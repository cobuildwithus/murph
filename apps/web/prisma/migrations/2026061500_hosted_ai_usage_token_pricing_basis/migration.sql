ALTER TABLE "hosted_ai_usage"
  ADD COLUMN "token_pricing_basis" TEXT NOT NULL DEFAULT 'standard';

CREATE INDEX "hosted_ai_usage_token_pricing_basis_occurred_at_idx"
  ON "hosted_ai_usage"("token_pricing_basis", "occurred_at");
