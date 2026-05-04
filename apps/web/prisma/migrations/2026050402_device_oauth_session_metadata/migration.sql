-- Additive state metadata for hosted device connection callbacks.
ALTER TABLE "device_oauth_session"
  ADD COLUMN "metadata_json" JSONB;
