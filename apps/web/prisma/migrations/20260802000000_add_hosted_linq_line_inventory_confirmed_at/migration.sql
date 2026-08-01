-- Additive freshness watermark for validated provider phone-number snapshots.
-- Nullable with no backfill: rows written before this migration have no
-- confirmed snapshot, so ownership-gated consumers fail closed until the
-- next successful inventory sync stamps them.
ALTER TABLE "hosted_linq_line"
  ADD COLUMN IF NOT EXISTS "provider_inventory_confirmed_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "hosted_linq_line_provider_inventory_confirmed_at_idx"
  ON "hosted_linq_line" ("provider_inventory_confirmed_at");
