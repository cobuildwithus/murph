ALTER TABLE "hosted_share_link"
ADD COLUMN "preview_json" JSONB;

UPDATE "hosted_share_link"
SET "preview_json" = jsonb_build_object(
  'kinds', '[]'::jsonb,
  'counts',
  jsonb_build_object(
    'foods', 0,
    'protocols', 0,
    'recipes', 0,
    'total', 0
  ),
  'logMealAfterImport', false
)
WHERE "preview_json" IS NULL;

ALTER TABLE "hosted_share_link"
ALTER COLUMN "preview_json" SET NOT NULL;

ALTER TABLE "hosted_share_link"
DROP COLUMN "preview_title";
