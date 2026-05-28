CREATE UNIQUE INDEX "hosted_mailbox_item_user_id_id_key"
  ON "hosted_mailbox_item"("user_id", "id");

CREATE TABLE "hosted_ingress_latency_trace" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "mailbox_item_id" TEXT NOT NULL,
  "mailbox_lane" TEXT NOT NULL,
  "mailbox_lane_seq" BIGINT NOT NULL,
  "assistant_input_id" TEXT,
  "runtime_attempt_id" TEXT,
  "accepted_at" TIMESTAMP(3) NOT NULL,
  "temporal_signal_accepted_at" TIMESTAMP(3),
  "assistant_input_staged_at" TIMESTAMP(3),
  "provider_start_at" TIMESTAMP(3),
  "provider_request_ordinal" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hosted_ingress_latency_trace_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hosted_ingress_latency_trace_user_id_mailbox_item_id_fkey"
    FOREIGN KEY ("user_id", "mailbox_item_id")
    REFERENCES "hosted_mailbox_item"("user_id", "id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "hosted_ingress_latency_trace_mailbox_item_id_key"
  ON "hosted_ingress_latency_trace"("mailbox_item_id");

CREATE UNIQUE INDEX "hosted_ingress_latency_trace_user_id_mailbox_item_id_key"
  ON "hosted_ingress_latency_trace"("user_id", "mailbox_item_id");

CREATE INDEX "hosted_ingress_latency_trace_source_accepted_at_idx"
  ON "hosted_ingress_latency_trace"("source", "accepted_at");

CREATE INDEX "hosted_ingress_latency_trace_source_provider_start_at_idx"
  ON "hosted_ingress_latency_trace"("source", "provider_start_at");

CREATE INDEX "hosted_ingress_latency_trace_user_id_accepted_at_idx"
  ON "hosted_ingress_latency_trace"("user_id", "accepted_at");

CREATE INDEX "hosted_ingress_latency_trace_assistant_input_id_idx"
  ON "hosted_ingress_latency_trace"("assistant_input_id");

CREATE INDEX "hosted_ingress_latency_trace_runtime_attempt_id_idx"
  ON "hosted_ingress_latency_trace"("runtime_attempt_id");
