CREATE INDEX CONCURRENTLY "hosted_ingress_latency_trace_source_staged_at_idx"
  ON "hosted_ingress_latency_trace"("source", "assistant_input_staged_at");

CREATE INDEX CONCURRENTLY "hosted_linq_delivery_accepted_at_id_idx"
  ON "hosted_linq_delivery"("accepted_at", "id");

CREATE INDEX CONCURRENTLY "hosted_mailbox_item_consumed_at_id_idx"
  ON "hosted_mailbox_item"("consumed_at", "id");
