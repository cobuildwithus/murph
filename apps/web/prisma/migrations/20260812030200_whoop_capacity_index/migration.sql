CREATE INDEX CONCURRENTLY "device_connection_active_provider_member_idx"
  ON "device_connection"("provider", "user_id")
  WHERE "status" <> 'disconnected';

CREATE INDEX CONCURRENTLY "device_connection_source_active_provider_connection_idx"
  ON "device_connection_source"("source_provider_slug", "connection_id")
  WHERE "status" <> 'disconnected';
