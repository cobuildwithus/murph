ALTER TABLE "device_connection"
  ADD COLUMN "refresh_lease_owner" TEXT,
  ADD COLUMN "refresh_lease_expires_at" TIMESTAMP(3),
  ADD COLUMN "refresh_lease_token_version" INTEGER;

ALTER TABLE "device_connection"
  ADD CONSTRAINT "device_connection_refresh_lease_complete_check"
  CHECK (
    (
      "refresh_lease_owner" IS NULL
      AND "refresh_lease_expires_at" IS NULL
      AND "refresh_lease_token_version" IS NULL
    )
    OR (
      "refresh_lease_owner" IS NOT NULL
      AND "refresh_lease_expires_at" IS NOT NULL
      AND "refresh_lease_token_version" IS NOT NULL
    )
  );
