ALTER TABLE "hosted_runtime_owner"
  ADD COLUMN "background_window_started_at" TIMESTAMP(3),
  ADD COLUMN "background_start_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_background_started_at" TIMESTAMP(3);
