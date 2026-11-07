-- Enrollment belongs to the canonical creation transaction, including old Web
-- writers that do not call the current application helper. A new member row
-- cannot prove that an overlapping old Worker never materialized its source.
ALTER TABLE hosted_runtime_owner
  DROP CONSTRAINT hosted_runtime_owner_migration_phase_check,
  ADD CONSTRAINT hosted_runtime_owner_migration_phase_check
    CHECK (migration_phase IN ('legacy', 'pending', 'quiescing', 'freezing', 'importing', 'postgres'));

CREATE FUNCTION enroll_hosted_runtime_member()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  campaign_phase TEXT;
BEGIN
  -- Some creators already hold family/contact locks. Fail for retry instead of
  -- waiting behind a campaign transition with an inverted lock order.
  SELECT phase INTO campaign_phase FROM hosted_runtime_cutover
    WHERE id = 'runtime' FOR SHARE NOWAIT;
  IF campaign_phase IS NULL OR campaign_phase NOT IN ('legacy', 'draining', 'rolling', 'postgres') THEN
    RAISE EXCEPTION 'Hosted runtime creation requires a known cutover state.';
  END IF;
  IF campaign_phase = 'rolling' THEN
    -- No conflict update: a retained owner is a conflicting identity, not an
    -- invitation to overwrite a generation, source receipt, or cleanup target.
    INSERT INTO hosted_runtime_owner (user_id, migration_phase, updated_at)
    VALUES (NEW.id, 'pending', CURRENT_TIMESTAMP);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER hosted_runtime_member_enrollment
AFTER INSERT ON hosted_member
FOR EACH ROW EXECUTE FUNCTION enroll_hosted_runtime_member();
