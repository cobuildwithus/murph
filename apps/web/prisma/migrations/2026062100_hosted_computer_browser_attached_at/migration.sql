ALTER TABLE "hosted_computer_run"
  ADD COLUMN "browser_attached_at" TIMESTAMP(3);

UPDATE "hosted_computer_run"
SET "browser_attached_at" = "updated_at"
WHERE "browser_attached_at" IS NULL
  AND (
    "kernel_session_id" IS NOT NULL
    OR "kernel_live_view_url_encrypted" IS NOT NULL
  );
