ALTER TABLE "hosted_member"
ADD COLUMN "initial_onboarding_completed_at" TIMESTAMP(3);

-- Existing members predate the one-time cross-platform onboarding gate and
-- must not be sent through it again.
UPDATE "hosted_member"
SET "initial_onboarding_completed_at" = "created_at"
WHERE "initial_onboarding_completed_at" IS NULL;

-- During a rolling deployment, the previous application can still create a
-- member after this migration has run. Its insert omits this new column, so a
-- temporary database default marks that legacy-flow member complete. The new
-- application explicitly writes null for genuinely new onboarding members.
ALTER TABLE "hosted_member"
ALTER COLUMN "initial_onboarding_completed_at" SET DEFAULT CURRENT_TIMESTAMP;
