ALTER TABLE "hosted_ai_usage"
  ADD COLUMN "token_pricing_basis" TEXT NOT NULL DEFAULT 'standard';
