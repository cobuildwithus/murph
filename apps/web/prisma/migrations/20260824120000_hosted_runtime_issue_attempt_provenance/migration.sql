ALTER TABLE "hosted_assistant_runtime_issue"
ADD COLUMN "runtime_attempt_id" TEXT;

CREATE INDEX "hosted_assistant_runtime_issue_runtime_attempt_id_occurred_at_idx"
ON "hosted_assistant_runtime_issue"("runtime_attempt_id", "occurred_at");
