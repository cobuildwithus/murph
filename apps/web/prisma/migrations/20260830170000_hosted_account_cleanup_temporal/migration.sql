ALTER TABLE "hosted_account_deletion_cleanup"
  ADD COLUMN "temporal_completed_at" TIMESTAMP(3);

-- Preserve Temporal cleanup ownership across rolling deploys and emergency
-- rollback. Older application versions do not know this target and may delete
-- a receipt after only their legacy targets complete.
CREATE FUNCTION "prevent_pending_temporal_cleanup_receipt_delete"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."temporal_completed_at" IS NULL THEN
    RAISE EXCEPTION
      'account deletion cleanup receipt still owns Temporal workflow termination'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "hosted_account_deletion_cleanup_temporal_delete_guard"
BEFORE DELETE ON "hosted_account_deletion_cleanup"
FOR EACH ROW
EXECUTE FUNCTION "prevent_pending_temporal_cleanup_receipt_delete"();
