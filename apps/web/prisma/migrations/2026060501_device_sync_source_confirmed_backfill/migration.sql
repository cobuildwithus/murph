-- Device-sync setup is provider-connection state, not first-sync-success
-- state. Successful provider callbacks now write source_confirmed directly;
-- this backfills active rows created before that transition and makes rows that
-- may have missed their first runtime handoff eligible for the normal due
-- reconcile mailbox wake path.

UPDATE "device_connection"
SET
  "setup_phase" = 'source_confirmed',
  "setup_expires_at" = NULL,
  "updated_at" = NOW()
WHERE "status" = 'active'
  AND "setup_phase" IN ('pending_link', 'link_returned')
  AND (
    (
      "credential_kind" = 'oauth_tokens'
      AND "access_token_encrypted" IS NOT NULL
    )
    OR (
      "credential_kind" = 'provider_config'
      AND "provider_config_key" IS NOT NULL
    )
  );

UPDATE "device_connection" AS "connection"
SET
  "next_reconcile_at" = LEAST(COALESCE("connection"."next_reconcile_at", NOW()), NOW()),
  "updated_at" = NOW()
WHERE "connection"."status" = 'active'
  AND (
    "connection"."last_sync_started_at" IS NULL
    OR EXISTS (
      SELECT 1
      FROM "device_sync_dirty_connection" AS "dirty"
      WHERE "dirty"."connection_id" = "connection"."id"
        AND (
          "dirty"."dirty_revision" > "dirty"."processed_revision"
          OR EXISTS (
            SELECT 1
            FROM "device_sync_dirty_payload" AS "payload"
            WHERE "payload"."connection_id" = "dirty"."connection_id"
              AND "payload"."user_id" = "dirty"."user_id"
          )
        )
    )
  )
  AND (
    (
      "connection"."credential_kind" = 'oauth_tokens'
      AND "connection"."access_token_encrypted" IS NOT NULL
    )
    OR (
      "connection"."credential_kind" = 'provider_config'
      AND "connection"."provider_config_key" IS NOT NULL
    )
  );
