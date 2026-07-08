-- Keep consumed OAuth states until they expire so redelivered callback
-- navigations resolve as replays instead of unknown states.
ALTER TABLE "device_oauth_session" ADD COLUMN "consumed_at" TIMESTAMP(3);
