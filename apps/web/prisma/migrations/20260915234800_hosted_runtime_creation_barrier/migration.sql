-- Separate new legacy materialization from execution of registered members.
ALTER TABLE hosted_runtime_cutover
  ADD COLUMN discovery_completed_at TIMESTAMP(3),
  ADD COLUMN creation_closed_at TIMESTAMP(3);

-- Admission intent precedes source RPCs and survives canonical member deletion.
-- user_id remains the separately reserved migration/export identity.
ALTER TABLE hosted_runtime_legacy_import ADD COLUMN admitted_user_id TEXT;
CREATE UNIQUE INDEX hosted_runtime_legacy_import_admitted_user_id_key
  ON hosted_runtime_legacy_import (admitted_user_id);
