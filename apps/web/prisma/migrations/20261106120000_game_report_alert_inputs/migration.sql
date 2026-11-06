-- Freeze the accepted alert inputs so retries keep the same provider payload
-- after content changes or deletion. Legacy rows stay NULL.
ALTER TABLE "game_report"
  ADD COLUMN "alert_blocked" BOOLEAN,
  ADD COLUMN "alert_entry_kind" TEXT,
  ADD COLUMN "alert_from_invite" BOOLEAN,
  ADD COLUMN "alert_game_id" TEXT;
