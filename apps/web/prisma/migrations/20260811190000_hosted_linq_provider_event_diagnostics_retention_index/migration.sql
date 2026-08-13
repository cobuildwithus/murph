CREATE INDEX CONCURRENTLY "hosted_linq_provider_event_diagnostics_retention_idx"
  ON "hosted_linq_provider_event"("received_at", "event_id")
  WHERE "extraction_json" IS NOT NULL
    OR "payload_sanitized_json" IS NOT NULL
    OR "payload_shape_json" IS NOT NULL;
