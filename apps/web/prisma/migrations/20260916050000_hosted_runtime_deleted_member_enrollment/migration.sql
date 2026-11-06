-- Retain an identity deleted between campaign start and exact-source enrollment.
-- No member FK: the retained owner is also the existing cleanup authority.
CREATE FUNCTION retain_hosted_runtime_member_for_migration()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  campaign_phase TEXT;
BEGIN
  SELECT phase INTO campaign_phase FROM hosted_runtime_cutover
    WHERE id = 'runtime' FOR SHARE NOWAIT;
  IF campaign_phase IS NULL THEN
    RAISE EXCEPTION 'Hosted runtime deletion requires a known cutover state.';
  END IF;
  IF campaign_phase = 'rolling' THEN
    INSERT INTO hosted_runtime_owner (user_id, migration_phase, updated_at)
    VALUES (OLD.id, 'legacy', CURRENT_TIMESTAMP)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER hosted_runtime_deleted_member_enrollment
BEFORE DELETE ON hosted_member
FOR EACH ROW EXECUTE FUNCTION retain_hosted_runtime_member_for_migration();
