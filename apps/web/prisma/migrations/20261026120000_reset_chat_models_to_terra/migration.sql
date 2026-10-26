-- Reset personal and synthetic group chat overrides once. The application owns
-- scope-specific defaults (personal Terra; group Sol). Later explicit
-- selections remain ordinary preferences.
-- Deploy Terra-capable runtime readers before promoting the matching Web build.
UPDATE "hosted_member"
SET "assistant_model_preference" = NULL
WHERE "assistant_model_preference" IS NOT NULL;
