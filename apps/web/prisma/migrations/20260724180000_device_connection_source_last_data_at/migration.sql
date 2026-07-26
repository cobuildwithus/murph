-- Records the last inbound payload that actually carried this source's data.
-- `last_seen_at` only proves the provider still lists the source, so it cannot
-- distinguish a live push carrier from one the provider silently stopped
-- feeding. Null until the first such payload lands.
ALTER TABLE "device_connection_source"
  ADD COLUMN "last_data_at" TIMESTAMP(3);
