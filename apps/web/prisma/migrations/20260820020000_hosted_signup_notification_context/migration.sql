ALTER TABLE "hosted_member"
  ADD COLUMN "signup_notification_context_encrypted" TEXT;

CREATE FUNCTION clear_hosted_signup_notification_context_on_attempt()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."signup_notification_email_attempted_at" IS NOT NULL THEN
    NEW."signup_notification_context_encrypted" := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "hosted_signup_notification_context_attempt_clear"
BEFORE UPDATE OF
  "signup_notification_email_attempted_at",
  "signup_notification_context_encrypted"
ON "hosted_member"
FOR EACH ROW
EXECUTE FUNCTION clear_hosted_signup_notification_context_on_attempt();
