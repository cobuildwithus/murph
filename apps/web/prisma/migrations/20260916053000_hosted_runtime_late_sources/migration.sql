-- A selected source remains durable before its local barrier or reservation
-- reply. No clock, lease, or newly discovered object can replace that selection.
ALTER TABLE hosted_runtime_cutover ADD COLUMN selected_object_id TEXT;

-- The original seal covers only baseline rows. Late observations are retained
-- for exact disposition without changing the original hash or granting legacy
-- admission merely because their inventory row exists.
ALTER TABLE hosted_runtime_legacy_import
  ADD COLUMN inventory_class TEXT NOT NULL DEFAULT 'baseline';
ALTER TABLE hosted_runtime_legacy_import
  ADD CONSTRAINT hosted_runtime_legacy_import_inventory_class_check
  CHECK (inventory_class IN ('baseline', 'late'));
CREATE INDEX hosted_runtime_legacy_import_inventory_class_object_id_idx
  ON hosted_runtime_legacy_import (inventory_class, object_id);
