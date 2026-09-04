BEGIN;

ALTER TABLE "hosted_member_identity"
  ADD COLUMN "linq_email_handle_lookup_key" TEXT;

CREATE TEMP TABLE "linq_email_identity_backfill" ON COMMIT DROP AS
  SELECT "member_id", "linq_participant_contact_lookup_key" AS "lookup_key"
  FROM "hosted_member_routing"
  WHERE "linq_participant_contact_kind" = 'email'
    AND "linq_participant_contact_lookup_key" IS NOT NULL
  UNION
  SELECT "member_id", "pending_linq_participant_contact_lookup_key" AS "lookup_key"
  FROM "hosted_member_routing"
  WHERE "pending_linq_participant_contact_kind" = 'email'
    AND "pending_linq_participant_contact_lookup_key" IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "linq_email_identity_backfill"
    GROUP BY "lookup_key"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot backfill Linq email handle identity: one handle belongs to multiple members';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "linq_email_identity_backfill"
    GROUP BY "member_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot backfill Linq email handle identity: one member has multiple handles';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "linq_email_identity_backfill" routes
    LEFT JOIN "hosted_member_identity" identity
      ON identity."member_id" = routes."member_id"
    WHERE identity."member_id" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot backfill Linq email handle identity: a route owner has no identity row';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "linq_email_identity_backfill" routes
    JOIN "hosted_member_email_authorization" email_auth
      ON email_auth."verified_email_lookup_key" = routes."lookup_key"
    WHERE email_auth."member_id" <> routes."member_id"
  ) THEN
    RAISE EXCEPTION
      'Cannot backfill Linq email handle identity: verified email belongs to another member';
  END IF;
END $$;

UPDATE "hosted_member_identity" identity
SET "linq_email_handle_lookup_key" = routes."lookup_key"
FROM "linq_email_identity_backfill" routes
WHERE identity."member_id" = routes."member_id";

CREATE UNIQUE INDEX "hosted_member_identity_linq_email_handle_lookup_key_key"
  ON "hosted_member_identity"("linq_email_handle_lookup_key");

COMMIT;
