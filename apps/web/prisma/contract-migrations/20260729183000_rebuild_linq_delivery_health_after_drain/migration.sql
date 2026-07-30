-- Predeploy must leave this legacy column untouched while the prior Web build
-- can still interpret provider status through it. After the replacement build
-- is live and prior functions drain, first retain any final provider status
-- written by an old function during the rollout window.
UPDATE "hosted_linq_line"
SET
  "provider_service_status" = UPPER("provider_status"),
  "provider_service_updated_at" = "provider_updated_at",
  "last_service_status_event_id" = "last_status_event_id"
WHERE UPPER("provider_status") IN ('ACTIVE', 'FLAGGED')
  AND (
    "provider_service_updated_at" IS NULL
    OR "provider_updated_at" > "provider_service_updated_at"
    OR (
      "provider_updated_at" = "provider_service_updated_at"
      AND COALESCE("last_status_event_id", '') >
        COALESCE("last_service_status_event_id", '')
    )
  );

UPDATE "hosted_linq_line"
SET
  "provider_reputation_status" = UPPER("provider_status"),
  "provider_reputation_updated_at" = "provider_updated_at",
  "last_reputation_status_event_id" = "last_status_event_id"
WHERE UPPER("provider_status") IN ('HEALTHY', 'AT_RISK', 'CRITICAL')
  AND (
    "provider_reputation_updated_at" IS NULL
    OR "provider_updated_at" > "provider_reputation_updated_at"
    OR (
      "provider_updated_at" = "provider_reputation_updated_at"
      AND COALESCE("last_status_event_id", '') >
        COALESCE("last_reputation_status_event_id", '')
    )
  );

-- Once legacy writes cannot resume, reconstruct only Murph-observed delivery
-- health. Independent provider hard blocks remain in their dedicated columns.
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
