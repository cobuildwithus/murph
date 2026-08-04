ALTER TABLE "hosted_member"
ADD COLUMN "initial_onboarding_completed_at" TIMESTAMP(3);

-- Existing members predate the one-time cross-platform onboarding gate and
-- must not be sent through it again. Members created after this migration keep
-- this column null and therefore begin pending.
UPDATE "hosted_member"
SET "initial_onboarding_completed_at" = "created_at"
WHERE "initial_onboarding_completed_at" IS NULL;
