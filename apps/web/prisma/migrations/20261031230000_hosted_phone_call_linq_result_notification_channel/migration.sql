-- Restore direct iMessage phone-call reservations on databases whose original
-- notification-channel migration created only the Telegram value.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TYPE "HostedPhoneCallResultNotificationChannel" ADD VALUE IF NOT EXISTS 'linq';

COMMIT;
