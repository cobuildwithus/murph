BEGIN;

-- Draining Web instances can still write the legacy enum label.
CREATE FUNCTION normalize_clinical_record_message_mode() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.clinical_record_message_mode := 'notice';
  RETURN NEW;
END;
$$;

CREATE TRIGGER normalize_clinical_record_message_mode
BEFORE INSERT OR UPDATE OF clinical_record_message_mode ON hosted_member
FOR EACH ROW WHEN (NEW.clinical_record_message_mode = 'detail')
EXECUTE FUNCTION normalize_clinical_record_message_mode();

UPDATE hosted_member
SET clinical_record_message_mode = 'notice',
    clinical_record_message_revision = clinical_record_message_revision + 1
WHERE clinical_record_message_mode = 'detail';

COMMIT;
