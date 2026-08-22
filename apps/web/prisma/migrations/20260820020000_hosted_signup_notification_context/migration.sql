ALTER TABLE "hosted_member"
  ADD COLUMN "signup_notification_context_encrypted" TEXT,
  ADD COLUMN "signup_notification_context_expires_at" TIMESTAMP(3);

CREATE INDEX CONCURRENTLY "hosted_member_signup_notification_context_retention_idx"
  ON "hosted_member"(
    "signup_notification_context_expires_at" ASC NULLS FIRST,
    "id" ASC
  )
  WHERE "signup_notification_context_encrypted" IS NOT NULL;

CREATE FUNCTION clear_hosted_signup_notification_context_on_attempt()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."signup_notification_email_attempted_at" IS NOT NULL
    OR NEW."signup_notification_context_encrypted" IS NULL THEN
    NEW."signup_notification_context_encrypted" := NULL;
    NEW."signup_notification_context_expires_at" := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "hosted_signup_notification_context_attempt_clear"
BEFORE UPDATE OF
  "signup_notification_email_attempted_at",
  "signup_notification_context_encrypted",
  "signup_notification_context_expires_at"
ON "hosted_member"
FOR EACH ROW
EXECUTE FUNCTION clear_hosted_signup_notification_context_on_attempt();
