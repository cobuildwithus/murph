-- Drop the superseded /api/linq control-plane persistence tables.
DROP TABLE IF EXISTS "linq_webhook_event";
DROP TABLE IF EXISTS "linq_recipient_binding";
