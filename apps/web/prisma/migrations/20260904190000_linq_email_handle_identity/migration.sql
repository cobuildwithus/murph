ALTER TABLE "hosted_member_identity"
  ADD COLUMN "linq_email_handle_lookup_key" TEXT;

DO $$
BEGIN
  IF EXISTS (
    WITH email_routes AS (
      SELECT "member_id", "linq_participant_contact_lookup_key" AS "lookup_key"
      FROM "hosted_member_routing"
      WHERE "linq_participant_contact_kind" = 'email'
        AND "linq_participant_contact_lookup_key" IS NOT NULL
      UNION ALL
      SELECT "member_id", "pending_linq_participant_contact_lookup_key" AS "lookup_key"
      FROM "hosted_member_routing"
      WHERE "pending_linq_participant_contact_kind" = 'email'
        AND "pending_linq_participant_contact_lookup_key" IS NOT NULL
    )
    SELECT 1
    FROM email_routes
    GROUP BY "lookup_key"
    HAVING count(DISTINCT "member_id") > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot backfill Linq email handle identity: one handle belongs to multiple members';
  END IF;

  IF EXISTS (
    WITH email_routes AS (
      SELECT "member_id", "linq_participant_contact_lookup_key" AS "lookup_key"
      FROM "hosted_member_routing"
      WHERE "linq_participant_contact_kind" = 'email'
        AND "linq_participant_contact_lookup_key" IS NOT NULL
      UNION ALL
      SELECT "member_id", "pending_linq_participant_contact_lookup_key" AS "lookup_key"
      FROM "hosted_member_routing"
      WHERE "pending_linq_participant_contact_kind" = 'email'
        AND "pending_linq_participant_contact_lookup_key" IS NOT NULL
    )
    SELECT 1
    FROM email_routes
    GROUP BY "member_id"
    HAVING count(DISTINCT "lookup_key") > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot backfill Linq email handle identity: one member has multiple handles';
  END IF;

  IF EXISTS (
    WITH email_routes AS (
      SELECT "member_id"
      FROM "hosted_member_routing"
      WHERE "linq_participant_contact_kind" = 'email'
        AND "linq_participant_contact_lookup_key" IS NOT NULL
      UNION
      SELECT "member_id"
      FROM "hosted_member_routing"
      WHERE "pending_linq_participant_contact_kind" = 'email'
        AND "pending_linq_participant_contact_lookup_key" IS NOT NULL
    )
    SELECT 1
    FROM email_routes routes
    LEFT JOIN "hosted_member_identity" identity
      ON identity."member_id" = routes."member_id"
    WHERE identity."member_id" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot backfill Linq email handle identity: a route owner has no identity row';
  END IF;

  IF EXISTS (
    WITH email_routes AS (
      SELECT "member_id", "linq_participant_contact_lookup_key" AS "lookup_key"
      FROM "hosted_member_routing"
      WHERE "linq_participant_contact_kind" = 'email'
        AND "linq_participant_contact_lookup_key" IS NOT NULL
      UNION
      SELECT "member_id", "pending_linq_participant_contact_lookup_key" AS "lookup_key"
      FROM "hosted_member_routing"
      WHERE "pending_linq_participant_contact_kind" = 'email'
        AND "pending_linq_participant_contact_lookup_key" IS NOT NULL
    )
    SELECT 1
    FROM email_routes routes
    JOIN "hosted_member_email_authorization" email_auth
      ON email_auth."verified_email_lookup_key" = routes."lookup_key"
    WHERE email_auth."member_id" <> routes."member_id"
  ) THEN
    RAISE EXCEPTION
      'Cannot backfill Linq email handle identity: verified email belongs to another member';
  END IF;
END $$;

WITH email_routes AS (
  SELECT "member_id", "linq_participant_contact_lookup_key" AS "lookup_key"
  FROM "hosted_member_routing"
  WHERE "linq_participant_contact_kind" = 'email'
    AND "linq_participant_contact_lookup_key" IS NOT NULL
  UNION
  SELECT "member_id", "pending_linq_participant_contact_lookup_key" AS "lookup_key"
  FROM "hosted_member_routing"
  WHERE "pending_linq_participant_contact_kind" = 'email'
    AND "pending_linq_participant_contact_lookup_key" IS NOT NULL
), member_handles AS (
  SELECT "member_id", min("lookup_key") AS "lookup_key"
  FROM email_routes
  GROUP BY "member_id"
)
UPDATE "hosted_member_identity" identity
SET "linq_email_handle_lookup_key" = member_handles."lookup_key"
FROM member_handles
WHERE identity."member_id" = member_handles."member_id";

CREATE UNIQUE INDEX "hosted_member_identity_linq_email_handle_lookup_key_key"
  ON "hosted_member_identity"("linq_email_handle_lookup_key");
