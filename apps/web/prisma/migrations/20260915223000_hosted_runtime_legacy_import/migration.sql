ALTER TABLE "hosted_runtime_cutover"
  ADD COLUMN "namespace_id" TEXT,
  ADD COLUMN "worker_version" TEXT,
  ADD COLUMN "inventory_after" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "inventory_hash" TEXT,
  ADD COLUMN "inventory_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "inventory_sealed_at" TIMESTAMP(3),
  ADD COLUMN "activated_at" TIMESTAMP(3);

CREATE TABLE "hosted_runtime_legacy_import" (
  "object_id" TEXT PRIMARY KEY,
  "user_id" TEXT,
  "generation" BIGINT,
  "next_cursor" JSONB NOT NULL,
  "last_cursor" JSONB,
  "last_hash" TEXT,
  "completed_at" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "hosted_runtime_legacy_import_user_id_key" ON "hosted_runtime_legacy_import"("user_id");
CREATE INDEX "hosted_runtime_legacy_import_completed_at_object_id_idx" ON "hosted_runtime_legacy_import"("completed_at", "object_id");
