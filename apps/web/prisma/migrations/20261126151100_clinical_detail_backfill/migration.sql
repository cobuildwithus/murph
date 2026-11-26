-- Convert stored notices after the member-table DDL lock is released.
-- The normalization trigger already covers writes from draining Web builds.
UPDATE hosted_member
SET clinical_record_message_mode = 'detail',
    clinical_record_message_revision = clinical_record_message_revision + 1
WHERE clinical_record_message_mode = 'notice';
