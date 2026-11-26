ALTER TABLE "clinical_record_retrieval_run"
  ADD COLUMN "notification_turn_id" TEXT,
  ADD COLUMN "notification_snapshot_id" TEXT,
  ADD COLUMN "notification_deferral" TEXT,
  ADD COLUMN "notification_retry_at" TIMESTAMP(3);

CREATE INDEX "clinical_record_retrieval_run_notification_retry_idx"
  ON "clinical_record_retrieval_run" ("notification_retry_at", "id")
  WHERE "notification_retry_at" IS NOT NULL;

CREATE INDEX "clinical_record_retrieval_run_notification_hold_idx"
  ON "clinical_record_retrieval_run" ("member_id", "connection_id", "id")
  WHERE "notification_deferral" IN ('route', 'retried');

-- A route with no resolvable window has no timer. Only a new identity can wake it.
CREATE FUNCTION wake_clinical_reply_on_verified_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.phone_lookup_key IS NOT DISTINCT FROM NEW.phone_lookup_key
    AND OLD.phone_number_verified_at IS NOT NULL AND OLD.phone_number_encrypted IS NOT NULL THEN
    RETURN NEW;
  END IF;
  UPDATE clinical_record_retrieval_run SET notification_retry_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
    notification_deferral = NULL WHERE member_id = NEW.member_id AND notification_deferral = 'route';
  RETURN NEW;
END
$$;
CREATE TRIGGER wake_clinical_reply_on_verified_number
AFTER INSERT OR UPDATE OF phone_lookup_key, phone_number_encrypted, phone_number_verified_at ON hosted_member_identity
FOR EACH ROW WHEN (NEW.phone_number_verified_at IS NOT NULL AND NEW.phone_number_encrypted IS NOT NULL)
EXECUTE FUNCTION wake_clinical_reply_on_verified_number();
