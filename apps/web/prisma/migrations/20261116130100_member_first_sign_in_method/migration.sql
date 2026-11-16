-- How each first-party account was first signed in to. Only an account first
-- signed in to with a phone or Telegram can approve MCP writes: an email-only
-- account can attach a first phone or Telegram from an email session, so no
-- passkey it later adds is independent of that inbox. The sign-in that claims
-- a member writes this once; changing sign-in methods never touches it.
ALTER TABLE "hosted_member" ADD COLUMN "first_sign_in_method" TEXT
  CHECK ("first_sign_in_method" IN ('email', 'phone', 'telegram'));

-- Existing accounts are classified once, only from records that a later change
-- of sign-in methods cannot produce. Anything else stays unknown, which MCP
-- writes treat like email.

-- A Telegram sign-in that claims a member writes its user and Telegram account
-- records with one timestamp, as the legacy importer did. A Telegram account
-- linked later, including a first one added from an email session, is newer.
UPDATE "hosted_member" AS "member"
SET "first_sign_in_method" = 'telegram'
WHERE EXISTS (
  SELECT 1
  FROM "hosted_auth_record" AS "user_record"
  JOIN "hosted_auth_record" AS "account_record"
    ON "account_record"."model" = 'account'
   AND "account_record"."member_id" = "user_record"."member_id"
   AND "account_record"."created_at" = "user_record"."created_at"
  WHERE "user_record"."model" = 'user'
    AND "user_record"."member_id" = "member"."id"
);

-- A phone sign-in that claims a member verifies the phone inside the same
-- transaction that writes the user record, which times out after ten seconds;
-- the legacy importer wrote user records after phones were verified. A phone
-- added later, including a first one added from an email session, is newer.
UPDATE "hosted_member" AS "member"
SET "first_sign_in_method" = 'phone'
FROM "hosted_auth_record" AS "user_record", "hosted_member_identity" AS "identity"
WHERE "member"."first_sign_in_method" IS NULL
  AND "user_record"."model" = 'user'
  AND "user_record"."member_id" = "member"."id"
  AND "identity"."member_id" = "member"."id"
  AND "identity"."phone_number_verified_at" <= "user_record"."created_at" + INTERVAL '10 seconds';
