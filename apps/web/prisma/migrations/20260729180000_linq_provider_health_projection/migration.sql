CREATE TABLE "hosted_linq_chat_health" (
  "linq_chat_lookup_key" TEXT NOT NULL,
  "phone_number_lookup_key" TEXT,
  "provider_status" TEXT NOT NULL,
  "provider_updated_at" TIMESTAMP(3) NOT NULL,
  "provider_observed_at" TIMESTAMP(3) NOT NULL,
  "is_group" BOOLEAN,
  "service" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hosted_linq_chat_health_pkey"
    PRIMARY KEY ("linq_chat_lookup_key")
);

ALTER TABLE "hosted_linq_chat_health"
  ADD CONSTRAINT "hosted_linq_chat_health_phone_number_lookup_key_fkey"
  FOREIGN KEY ("phone_number_lookup_key")
  REFERENCES "hosted_linq_line"("phone_number_lookup_key")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE INDEX "hosted_linq_chat_health_phone_status_idx"
  ON "hosted_linq_chat_health"("phone_number_lookup_key", "provider_status");
CREATE INDEX "hosted_linq_chat_health_status_updated_idx"
  ON "hosted_linq_chat_health"("provider_status", "provider_updated_at");

ALTER TABLE "hosted_linq_line"
  ADD COLUMN "provider_service_status" TEXT,
  ADD COLUMN "provider_reputation_status" TEXT;

CREATE INDEX "hosted_linq_line_provider_service_status_idx"
  ON "hosted_linq_line"("provider_service_status");
CREATE INDEX "hosted_linq_line_provider_reputation_status_idx"
  ON "hosted_linq_line"("provider_reputation_status");

ALTER TABLE "hosted_linq_provider_event"
  ADD COLUMN "provider_service_status" TEXT,
  ADD COLUMN "provider_reputation_status" TEXT,
  ADD COLUMN "chat_health_status" TEXT,
  ADD COLUMN "chat_health_updated_at" TIMESTAMP(3);

CREATE INDEX "hosted_linq_provider_event_chat_created_idx"
  ON "hosted_linq_provider_event"("linq_chat_lookup_key", "provider_created_at");

-- Preserve whatever independent provider dimension survived the legacy
-- single-status projection. Missing dimensions are repaired by the next
-- inventory/webhook reconciliation rather than guessed.
UPDATE "hosted_linq_line"
SET "provider_service_status" = CASE
    WHEN UPPER("provider_status") IN ('ACTIVE', 'FLAGGED')
      THEN UPPER("provider_status")
    ELSE NULL
  END,
  "provider_reputation_status" = CASE
    WHEN UPPER("provider_status") IN ('HEALTHY', 'AT_RISK', 'CRITICAL')
      THEN UPPER("provider_status")
    ELSE NULL
  END;

-- The legacy health_status mixed provider reputation with Murph-observed
-- delivery outcomes. Rebuild it only from local delivery evidence.
UPDATE "hosted_linq_line"
SET "health_status" = CASE
  WHEN "consecutive_failures" > 0
    THEN 'warning'
  WHEN "last_delivered_at" IS NOT NULL
    AND (
      "last_failed_at" IS NULL
      OR "last_delivered_at" >= "last_failed_at"
    )
    THEN 'healthy'
  ELSE 'unknown'
END;
