ALTER TABLE "hosted_ingress_latency_trace"
ADD COLUMN "webhook_received_at" TIMESTAMP(3),
ADD COLUMN "ingress_typing_accepted_at" TIMESTAMP(3);

CREATE INDEX "hosted_linq_alert_sent_typing_retention_idx"
ON "hosted_linq_alert" ("claimed_at", "id")
WHERE "kind" IN ('runtime_warm_typing_slow', 'runtime_cold_typing_slow')
  AND "status" = 'sent';
