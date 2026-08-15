-- Freeze only the bounded direct surface needed to route an asynchronous
-- phone-call result. No phone number, chat id, or call content is stored here.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TYPE "HostedPhoneCallResultNotificationChannel"
  AS ENUM ('linq', 'telegram');

ALTER TABLE "hosted_phone_call"
  ADD COLUMN "result_notification_channel"
    "HostedPhoneCallResultNotificationChannel";

COMMIT;
