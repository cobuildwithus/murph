BEGIN;

CREATE TYPE "ClinicalRecordMessageMode" AS ENUM ('off', 'notice', 'detail');
ALTER TABLE hosted_member
  ADD COLUMN clinical_record_message_mode "ClinicalRecordMessageMode" NOT NULL DEFAULT 'notice',
  ADD COLUMN clinical_record_message_revision INTEGER NOT NULL DEFAULT 0;

-- Older Web instances only write the consent grant. Keep their withdrawals
-- effective until they have drained and are no longer rollback targets.
CREATE FUNCTION disable_withdrawn_clinical_record_messages() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE hosted_member
  SET clinical_record_message_mode = 'off',
      clinical_record_message_revision = clinical_record_message_revision + 1
  WHERE id = NEW.member_id AND clinical_record_message_mode <> 'off';
  RETURN NEW;
END;
$$;

CREATE TRIGGER hosted_clinical_record_message_withdrawal_bridge
AFTER INSERT OR UPDATE OF status ON hosted_consent_grant
FOR EACH ROW WHEN (NEW.scope = 'launch.health-data' AND NEW.status = 'revoked')
EXECUTE FUNCTION disable_withdrawn_clinical_record_messages();

COMMIT;
