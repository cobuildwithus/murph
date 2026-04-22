ALTER TABLE "hosted_ai_usage" ADD COLUMN "feature_key" TEXT;
ALTER TABLE "hosted_ai_usage" ADD COLUMN "surface" TEXT;
ALTER TABLE "hosted_ai_usage" ADD COLUMN "trigger_kind" TEXT;
ALTER TABLE "hosted_ai_usage" ADD COLUMN "reporting_user_id" TEXT;
ALTER TABLE "hosted_ai_usage" ADD COLUMN "gateway_tags_json" JSONB;
ALTER TABLE "hosted_ai_usage" ADD COLUMN "stripe_meter_source" TEXT NOT NULL DEFAULT 'murph';

CREATE INDEX "hosted_ai_usage_feature_key_created_at_idx" ON "hosted_ai_usage"("feature_key", "created_at");
CREATE INDEX "hosted_ai_usage_reporting_user_id_created_at_idx" ON "hosted_ai_usage"("reporting_user_id", "created_at");
CREATE INDEX "hosted_ai_usage_surface_created_at_idx" ON "hosted_ai_usage"("surface", "created_at");
