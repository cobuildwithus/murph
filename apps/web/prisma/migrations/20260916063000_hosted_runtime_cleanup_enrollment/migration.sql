-- Nullable cursor: zero starts bounded identity retention; NULL means every
-- runtime identity has an independent canonical owner. No provider completion
-- field can stand in for source enrollment or member activation.
ALTER TABLE hosted_account_deletion_cleanup
  ADD COLUMN runtime_migration_next_index INTEGER DEFAULT 0;
CREATE INDEX hosted_cleanup_runtime_enrollment_idx
  ON hosted_account_deletion_cleanup (runtime_migration_next_index, id);

CREATE FUNCTION prevent_unenrolled_runtime_cleanup_receipt_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE campaign_phase TEXT;
BEGIN
  SELECT phase INTO campaign_phase FROM hosted_runtime_cutover
    WHERE id = 'runtime' FOR SHARE NOWAIT;
  IF campaign_phase = 'rolling' THEN
    RAISE EXCEPTION 'account deletion cleanup receipt still owns runtime enrollment'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER hosted_account_deletion_cleanup_runtime_enrollment_delete_guard
BEFORE DELETE ON hosted_account_deletion_cleanup
FOR EACH ROW WHEN (OLD.runtime_migration_next_index IS NOT NULL)
EXECUTE FUNCTION prevent_unenrolled_runtime_cleanup_receipt_delete();
