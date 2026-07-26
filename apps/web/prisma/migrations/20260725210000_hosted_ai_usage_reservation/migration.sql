CREATE UNIQUE INDEX "hosted_ai_usage_id_member_key"
  ON "hosted_ai_usage"("id", "member_id");

CREATE TABLE "hosted_ai_usage_reservation" (
  "request_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "estimator_version" TEXT NOT NULL,
  "image_quality" TEXT NOT NULL,
  "image_size" TEXT NOT NULL,
  "prompt_utf8_bytes" INTEGER NOT NULL,
  "reference_image_count" INTEGER NOT NULL,
  "estimated_cost_usd_micros" BIGINT NOT NULL,
  "allowance_source" TEXT NOT NULL,
  "period_start" TIMESTAMP(3) NOT NULL,
  "period_end" TIMESTAMP(3) NOT NULL,
  "dispatched_at" TIMESTAMP(3),
  "released_at" TIMESTAMP(3),
  "settled_usage_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "hosted_ai_usage_reservation_pkey" PRIMARY KEY ("request_id"),
  CONSTRAINT "hosted_ai_usage_reservation_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "hosted_ai_usage_reservation_settled_usage_fkey"
    FOREIGN KEY ("settled_usage_id", "member_id")
    REFERENCES "hosted_ai_usage"("id", "member_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "hosted_ai_usage_reservation_request_id_bounded"
    CHECK (
      length("request_id") BETWEEN 1 AND 256
      AND btrim("request_id") = "request_id"
    ),
  CONSTRAINT "hosted_ai_usage_reservation_estimator_version_bounded"
    CHECK (length("estimator_version") BETWEEN 1 AND 128),
  CONSTRAINT "hosted_ai_usage_reservation_estimate_positive"
    CHECK ("estimated_cost_usd_micros" > 0),
  CONSTRAINT "hosted_ai_usage_reservation_prompt_bytes_bounded"
    CHECK ("prompt_utf8_bytes" BETWEEN 1 AND 16118),
  CONSTRAINT "hosted_ai_usage_reservation_reference_count_bounded"
    CHECK ("reference_image_count" BETWEEN 0 AND 16),
  CONSTRAINT "hosted_ai_usage_reservation_image_quality_supported"
    CHECK ("image_quality" IN ('low', 'medium', 'high')),
  CONSTRAINT "hosted_ai_usage_reservation_image_size_supported"
    CHECK ("image_size" IN ('1024x1024', '1024x1536', '1536x1024')),
  CONSTRAINT "hosted_ai_usage_reservation_allowance_source_supported"
    CHECK (
      "allowance_source" IN (
        'direct_paid_member_plan',
        'direct_trial',
        'family_sponsored_plan',
        'thread_container'
      )
    ),
  CONSTRAINT "hosted_ai_usage_reservation_period_bounded"
    CHECK ("period_start" < "period_end"),
  CONSTRAINT "hosted_ai_usage_reservation_release_before_dispatch"
    CHECK ("released_at" IS NULL OR ("dispatched_at" IS NULL AND "settled_usage_id" IS NULL)),
  CONSTRAINT "hosted_ai_usage_reservation_settle_after_dispatch"
    CHECK ("settled_usage_id" IS NULL OR ("dispatched_at" IS NOT NULL AND "released_at" IS NULL)),
  CONSTRAINT "hosted_ai_usage_reservation_settlement_identity"
    CHECK ("settled_usage_id" IS NULL OR "settled_usage_id" = "request_id")
);

CREATE UNIQUE INDEX "hosted_ai_usage_reservation_settled_usage_key"
  ON "hosted_ai_usage_reservation"("settled_usage_id", "member_id");

CREATE INDEX "hosted_ai_usage_reservation_active_idx"
  ON "hosted_ai_usage_reservation"(
    "member_id",
    "settled_usage_id",
    "released_at",
    "period_end"
  );
