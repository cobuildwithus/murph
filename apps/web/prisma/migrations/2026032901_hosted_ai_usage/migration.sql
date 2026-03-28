-- CreateTable
CREATE TABLE "hosted_ai_usage" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "turn_id" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "provider" TEXT NOT NULL,
    "route_id" TEXT,
    "requested_model" TEXT,
    "served_model" TEXT,
    "provider_name" TEXT,
    "base_url" TEXT,
    "api_key_env" TEXT,
    "credential_source" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "reasoning_tokens" INTEGER,
    "cached_input_tokens" INTEGER,
    "cache_write_tokens" INTEGER,
    "total_tokens" INTEGER,
    "provider_session_id" TEXT,
    "provider_request_id" TEXT,
    "provider_metadata_json" JSONB,
    "raw_usage_json" JSONB,
    "stripe_meter_status" TEXT NOT NULL DEFAULT 'pending',
    "stripe_metered_at" TIMESTAMP(3),
    "stripe_meter_identifier" TEXT,
    "stripe_meter_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hosted_ai_usage_member_id_occurred_at_idx" ON "hosted_ai_usage"("member_id", "occurred_at");

-- CreateIndex
CREATE INDEX "hosted_ai_usage_stripe_meter_status_occurred_at_idx" ON "hosted_ai_usage"("stripe_meter_status", "occurred_at");

-- CreateIndex
CREATE INDEX "hosted_ai_usage_turn_id_attempt_count_idx" ON "hosted_ai_usage"("turn_id", "attempt_count");

-- AddForeignKey
ALTER TABLE "hosted_ai_usage" ADD CONSTRAINT "hosted_ai_usage_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
