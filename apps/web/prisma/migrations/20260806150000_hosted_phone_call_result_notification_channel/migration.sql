CREATE TYPE "HostedPhoneCallResultNotificationChannel" AS ENUM ('linq', 'telegram');

ALTER TABLE "hosted_phone_call"
ADD COLUMN "result_notification_channel" "HostedPhoneCallResultNotificationChannel";
