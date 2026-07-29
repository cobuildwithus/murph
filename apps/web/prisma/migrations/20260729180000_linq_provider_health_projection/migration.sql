CREATE TABLE "hosted_linq_line_provider_state" (
  "phone_number_lookup_key" TEXT NOT NULL,
  "service_status" TEXT,
  "reputation_status" TEXT,
  "provider_updated_at" TIMESTAMP(3),
  "provider_observed_at" TIMESTAMP(3) NOT NULL,
  "last_status_event_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hosted_linq_line_provider_state_pkey"
    PRIMARY KEY ("phone_number_lookup_key")
);

CREATE INDEX "hosted_linq_line_provider_state_service_status_idx"
  ON "hosted_linq_line_provider_state"("service_status");
CREATE INDEX "hosted_linq_line_provider_state_reputation_status_idx"
  ON "hosted_linq_line_provider_state"("reputation_status");
CREATE INDEX "hosted_linq_line_provider_state_provider_updated_at_idx"
  ON "hosted_linq_line_provider_state"("provider_updated_at");

CREATE TABLE "hosted_linq_chat_health" (
  "linq_chat_lookup_key" TEXT NOT NULL,
  "phone_number_lookup_key" TEXT,
  "provider_status" TEXT NOT NULL,
  "provider_updated_at" TIMESTAMP(3) NOT NULL,
  "provider_observed_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hosted_linq_chat_health_pkey"
    PRIMARY KEY ("linq_chat_lookup_key")
);

CREATE INDEX "hosted_linq_chat_health_phone_status_idx"
  ON "hosted_linq_chat_health"("phone_number_lookup_key", "provider_status");
CREATE INDEX "hosted_linq_chat_health_status_updated_idx"
  ON "hosted_linq_chat_health"("provider_status", "provider_updated_at");

-- Preserve whatever independent provider dimension survived the legacy
-- single-status projection. Missing dimensions are repaired by the next
-- inventory/webhook reconciliation rather than guessed.
INSERT INTO "hosted_linq_line_provider_state" (
  "phone_number_lookup_key",
  "service_status",
  "reputation_status",
  "provider_updated_at",
  "provider_observed_at",
  "last_status_event_id"
)
SELECT
  "phone_number_lookup_key",
  CASE
    WHEN UPPER("provider_status") IN ('ACTIVE', 'FLAGGED')
      THEN UPPER("provider_status")
    ELSE NULL
  END,
  CASE
    WHEN UPPER("provider_status") IN ('HEALTHY', 'AT_RISK', 'CRITICAL')
      THEN UPPER("provider_status")
    ELSE NULL
  END,
  "provider_updated_at",
  COALESCE(
    "provider_last_seen_at",
    "provider_seen_at",
    "provider_updated_at",
    "updated_at",
    CURRENT_TIMESTAMP
  ),
  "last_status_event_id"
FROM "hosted_linq_line"
ON CONFLICT ("phone_number_lookup_key") DO NOTHING;

-- The legacy health_status mixed provider reputation with Murph-observed
-- delivery outcomes. Rebuild it only from delivery evidence; provider state now
-- lives in hosted_linq_line_provider_state.
UPDATE "hosted_linq_line"
SET "health_status" = CASE
  WHEN "consecutive_failures" > 0
    OR (
      "last_failed_at" IS NOT NULL
      AND (
        "last_delivered_at" IS NULL
        OR "last_failed_at" > "last_delivered_at"
      )
    )
    THEN 'warning'
  WHEN "last_delivered_at" IS NOT NULL
    THEN 'healthy'
  ELSE 'unknown'
END;
