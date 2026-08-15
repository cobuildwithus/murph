-- Freeze only the bounded direct surface needed to route an asynchronous
-- phone-call result. No phone number, chat id, or call content is stored here.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TYPE "HostedPhoneCallResultNotificationChannel"
  AS ENUM ('telegram');

CREATE TYPE "HostedPhoneCallResultDeliveryStatus"
  AS ENUM ('pending', 'queued', 'sending', 'delivered', 'failed', 'ambiguous');

ALTER TABLE "hosted_phone_call"
  ADD COLUMN "result_notification_channel"
    "HostedPhoneCallResultNotificationChannel",
  ADD COLUMN "result_delivery_status"
    "HostedPhoneCallResultDeliveryStatus",
  ADD COLUMN "result_delivery_generation" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "result_delivery_terminal_at" TIMESTAMP(3);

CREATE INDEX "hosted_phone_call_result_delivery_idx"
  ON "hosted_phone_call"(
    "member_id",
    "result_notification_channel",
    "result_delivery_status",
    "created_at"
  );

COMMIT;
