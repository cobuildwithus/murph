-- Run after the Web deployment removing all readers/writers is live and drained.
DROP TABLE IF EXISTS "companion_wearable_command";
DROP TABLE IF EXISTS "companion_wearable_link";
DROP TABLE IF EXISTS "companion_wearable_session";
