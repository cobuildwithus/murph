CREATE TABLE "hosted_runtime_log" (
    "id" TEXT NOT NULL,
    "subject_key" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "level" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "event_code" TEXT NOT NULL,
    "attempt_id" TEXT,
    "lease_generation" BIGINT,
    "workspace_version" BIGINT,
    "checkpoint_version" BIGINT,
    "mailbox_lane" TEXT,
    "mailbox_seq_start" BIGINT,
    "mailbox_seq_end" BIGINT,
    "outbox_intent_ref" TEXT,
    "error_code" TEXT,
    "redacted_json" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hosted_runtime_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "hosted_runtime_log_subject_recent_idx"
    ON "hosted_runtime_log"("subject_key", "at" DESC, "id" DESC);
CREATE INDEX "hosted_runtime_log_attempt_event_at_idx"
    ON "hosted_runtime_log"("attempt_id", "event_code", "at" DESC);
CREATE INDEX "hosted_runtime_log_retention_idx"
    ON "hosted_runtime_log"("at", "id");
