-- Recovery ownership for `runner.accepted_attempt_failed` moves off the
-- diagnostic log table and onto workspace control state.
ALTER TABLE "hosted_workspace"
ADD COLUMN "accepted_attempt_failure_recheck_claimed_at" TIMESTAMP(3);

-- Ordered, bounded retention scans for the tables the hourly job now prunes.
-- `device_webhook_trace` already has (received_at) and
-- `hosted_assistant_runtime_issue` already has (expires_at), so those need no
-- new index.
CREATE INDEX "hosted_runtime_log_at_id_idx"
ON "hosted_runtime_log"("at", "id");

CREATE INDEX "hosted_ingress_latency_trace_accepted_at_id_idx"
ON "hosted_ingress_latency_trace"("accepted_at", "id");

CREATE INDEX "hosted_linq_provider_event_received_at_event_id_idx"
ON "hosted_linq_provider_event"("received_at", "event_id");
