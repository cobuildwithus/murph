-- Scan consent history after the member-table DDL lock is released.
-- A historical withdrawal also survives a subsequent regrant.
UPDATE hosted_member
SET clinical_record_message_mode = 'off', clinical_record_message_revision = 1
WHERE clinical_record_message_revision = 0 AND id IN (
  SELECT member_id FROM hosted_consent_grant WHERE scope = 'launch.health-data' AND status = 'revoked'
  UNION ALL
  SELECT member_id FROM hosted_consent_event WHERE scope = 'launch.health-data' AND action = 'revoked'
);
