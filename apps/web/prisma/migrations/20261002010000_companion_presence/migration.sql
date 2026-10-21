ALTER TABLE "hosted_member" ADD COLUMN "companion_last_foreground_at" TIMESTAMP(3);
ALTER TABLE "companion_wearable_command" ADD COLUMN "unavailable_reason" TEXT;
ALTER TABLE "hosted_member" ADD COLUMN "companion_last_contact_at" TIMESTAMP(3);
