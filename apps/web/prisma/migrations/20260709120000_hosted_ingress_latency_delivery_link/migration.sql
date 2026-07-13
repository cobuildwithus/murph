ALTER TABLE "hosted_ingress_latency_trace"
  ADD COLUMN "reply_runtime_attempt_id" TEXT,
  ADD COLUMN "linq_delivery_id" TEXT;

CREATE INDEX CONCURRENTLY "hosted_ingress_latency_trace_linq_delivery_id_idx"
  ON "hosted_ingress_latency_trace"("linq_delivery_id");

CREATE INDEX CONCURRENTLY "hosted_runtime_log_attempt_id_event_code_at_idx"
  ON "hosted_runtime_log"("attempt_id", "event_code", "at");

ALTER TABLE "hosted_ingress_latency_trace"
  ADD CONSTRAINT "hosted_ingress_latency_trace_linq_delivery_id_fkey"
    FOREIGN KEY ("linq_delivery_id")
    REFERENCES "hosted_linq_delivery"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
