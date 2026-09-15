CREATE TABLE hosted_runtime_snapshot_upload (
  user_id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  generation BIGINT NOT NULL CHECK (generation >= 0),
  expected_workspace_version BIGINT NOT NULL CHECK (expected_workspace_version >= 0),
  workspace_version BIGINT NOT NULL CHECK (workspace_version >= 0),
  object_key TEXT NOT NULL,
  encryption JSONB NOT NULL,
  replaced_snapshot_ref JSONB,
  created_at TIMESTAMP(3) NOT NULL,
  expires_at TIMESTAMP(3) NOT NULL,
  heartbeat_at TIMESTAMP(3) NOT NULL,
  completed_at TIMESTAMP(3),
  put_expires_at TIMESTAMP(3),
  put_drain_until TIMESTAMP(3),
  CHECK ((put_expires_at IS NULL AND put_drain_until IS NULL)
    OR (put_expires_at IS NOT NULL AND put_drain_until IS NOT NULL AND put_drain_until >= put_expires_at))
);
CREATE INDEX hosted_runtime_snapshot_upload_expires_at_user_id_idx ON hosted_runtime_snapshot_upload(expires_at, user_id);

CREATE TABLE hosted_runtime_put_drain (
  user_id TEXT NOT NULL,
  write_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('snapshot', 'replica', 'media')),
  attempt_id TEXT NOT NULL,
  generation BIGINT NOT NULL CHECK (generation >= 0),
  admitted_at TIMESTAMP(3) NOT NULL,
  drain_until TIMESTAMP(3),
  completed_at TIMESTAMP(3),
  PRIMARY KEY (user_id, write_id)
);
CREATE INDEX hosted_runtime_put_drain_drain_until_user_id_idx ON hosted_runtime_put_drain(drain_until, user_id);

CREATE TABLE hosted_runtime_orphan (
  user_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('snapshot', 'legacy_snapshot', 'replica')),
  object_key TEXT,
  snapshot_ref JSONB,
  created_at TIMESTAMP(3) NOT NULL,
  cleanup_at TIMESTAMP(3) NOT NULL,
  retired_at TIMESTAMP(3),
  purged_at TIMESTAMP(3),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  PRIMARY KEY (user_id, kind, resource_id),
  CHECK ((kind = 'legacy_snapshot' AND snapshot_ref IS NOT NULL)
    OR (kind <> 'legacy_snapshot' AND object_key IS NOT NULL))
);
CREATE INDEX hosted_runtime_orphan_purged_at_cleanup_at_user_id_idx ON hosted_runtime_orphan(purged_at, cleanup_at, user_id);

CREATE TABLE hosted_runtime_media (
  user_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  media_kind TEXT NOT NULL CHECK (media_kind IN ('image', 'video')),
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL,
  object_key TEXT NOT NULL,
  expires_at TIMESTAMP(3),
  retired_at TIMESTAMP(3),
  purged_at TIMESTAMP(3),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at TIMESTAMP(3) NOT NULL,
  PRIMARY KEY (user_id, media_id)
);
CREATE INDEX hosted_runtime_media_purged_at_expires_at_user_id_idx ON hosted_runtime_media(purged_at, expires_at, user_id);
