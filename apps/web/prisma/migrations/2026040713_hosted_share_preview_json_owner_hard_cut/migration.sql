ALTER TABLE "hosted_share_link"
ADD COLUMN "preview_json" JSONB;

UPDATE "hosted_share_link"
SET "preview_json" = jsonb_build_object(
  'counts',
  jsonb_build_object(
    'foods', 0,
    'protocols', 0,
    'recipes', 0
  ),
  'foodTitles', '[]'::jsonb,
  'protocolTitles', '[]'::jsonb,
  'recipeTitles', '[]'::jsonb,
  'logMealAfterImport', false,
  'title', COALESCE(NULLIF(BTRIM("preview_title"), ''), 'Shared Murph pack')
)
WHERE "preview_json" IS NULL;

ALTER TABLE "hosted_share_link"
ALTER COLUMN "preview_json" SET NOT NULL;
