ALTER TABLE "hosted_member"
  ADD COLUMN "onboarding_welcome_queued_at" TIMESTAMP(3),
  ADD COLUMN "onboarding_welcome_sent_at" TIMESTAMP(3);
