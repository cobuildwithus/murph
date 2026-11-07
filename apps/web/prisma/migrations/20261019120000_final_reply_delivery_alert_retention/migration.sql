CREATE INDEX "hosted_linq_alert_sent_final_reply_delivery_retention_idx"
ON "hosted_linq_alert" ("claimed_at", "id")
WHERE "kind" = 'runtime_final_reply_delivery_slow'
  AND "status" = 'sent';
