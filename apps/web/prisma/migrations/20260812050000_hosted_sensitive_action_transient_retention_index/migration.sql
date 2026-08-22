CREATE INDEX CONCURRENTLY "hosted_sensitive_action_challenge_transient_retention_idx"
  ON "hosted_sensitive_action_challenge"("expires_at", "token_hash")
  WHERE "approval_key" IS NULL;
