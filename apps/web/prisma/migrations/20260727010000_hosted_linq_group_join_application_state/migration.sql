-- Intentionally nullable and without a default. Existing rows, plus rows
-- written by an older application binary during rollout, must stay distinct
-- from newly received pending affirmations and therefore fail closed.
ALTER TABLE "hosted_linq_provider_event"
ADD COLUMN "group_join_application_state" TEXT;
