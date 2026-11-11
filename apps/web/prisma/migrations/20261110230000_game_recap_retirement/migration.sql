-- Recap receipts survive account/game deletion without changing the existing
-- runtime orphan kind constraint. The existing retention worker owns cleanup.
CREATE TABLE game_recap_asset (
  user_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL,
  cleanup_at TIMESTAMP(3) NOT NULL,
  recovery_until TIMESTAMP(3),
  retired_at TIMESTAMP(3),
  purged_at TIMESTAMP(3),
  revision BIGINT NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, resource_id)
);
CREATE INDEX game_recap_asset_purged_at_cleanup_at_user_id_idx
  ON game_recap_asset (purged_at, cleanup_at, user_id);
