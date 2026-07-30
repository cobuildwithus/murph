CREATE INDEX CONCURRENTLY "hosted_linq_delivery_line_accepted_at_idx"
  ON "hosted_linq_delivery"("phone_number_lookup_key", "accepted_at")
  WHERE "phone_number_lookup_key" IS NOT NULL
    AND "accepted_at" IS NOT NULL;

CREATE INDEX CONCURRENTLY "hosted_linq_provider_event_line_inbound_received_at_idx"
  ON "hosted_linq_provider_event"("phone_number_lookup_key", "received_at")
  WHERE "phone_number_lookup_key" IS NOT NULL
    AND "event_type" = 'message.received'
    AND "direction" = 'inbound';
