BEGIN;

ALTER TABLE hosted_member ALTER COLUMN clinical_record_message_mode SET DEFAULT 'detail';

-- Normalize explicit writes from draining Web builds as well as the stored default.
CREATE FUNCTION normalize_clinical_record_message_mode() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.clinical_record_message_mode := 'detail';
  RETURN NEW;
END;
$$;

CREATE TRIGGER normalize_clinical_record_message_mode
BEFORE INSERT OR UPDATE OF clinical_record_message_mode ON hosted_member
FOR EACH ROW WHEN (NEW.clinical_record_message_mode = 'notice')
EXECUTE FUNCTION normalize_clinical_record_message_mode();

UPDATE hosted_member
SET clinical_record_message_mode = 'detail',
    clinical_record_message_revision = clinical_record_message_revision + 1
WHERE clinical_record_message_mode = 'notice';

COMMIT;
