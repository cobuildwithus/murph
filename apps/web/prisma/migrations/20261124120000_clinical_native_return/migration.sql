ALTER TABLE "clinical_record_oauth_session"
  ALTER COLUMN "connect_intent_claim_hash" DROP NOT NULL,
  ADD COLUMN "app_return" TEXT,
  ADD CONSTRAINT "clinical_record_oauth_session_return_binding" CHECK (
    ("app_return" IS NULL AND "connect_intent_claim_hash" IS NOT NULL) OR
    ("app_return" IS NOT NULL AND "app_return" IN ('ios', 'ios-dev') AND "connect_intent_claim_hash" IS NULL)
  ) NOT VALID;
