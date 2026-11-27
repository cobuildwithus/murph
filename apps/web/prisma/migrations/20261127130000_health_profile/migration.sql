ALTER TABLE "game_profile"
  ADD COLUMN "cover_kind" TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN "cover_photo_key" TEXT,
  ADD COLUMN "cover_art" TEXT,
  ADD CONSTRAINT "game_profile_cover_check" CHECK (
    (cover_kind = 'none' AND cover_photo_key IS NULL AND cover_art IS NULL) OR
    (cover_kind = 'photo' AND cover_photo_key IS NOT NULL AND cover_art IS NULL) OR
    (cover_kind = 'art' AND cover_photo_key IS NULL AND cover_art IS NOT NULL AND cover_art IN ('leaf','cream','ink','gold'))
  ) NOT VALID;

CREATE TABLE "health_profile_pin" (
  member_id TEXT NOT NULL REFERENCES hosted_member(id) ON DELETE CASCADE ON UPDATE CASCADE,
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 2),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('milestone','streak','age')),
  source_key TEXT NOT NULL,
  spec_encrypted TEXT NOT NULL,
  refreshed_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (member_id, source_key),
  UNIQUE (member_id, position)
);

CREATE TABLE "health_working_on" (
  member_id TEXT NOT NULL REFERENCES hosted_member(id) ON DELETE CASCADE ON UPDATE CASCADE,
  factor TEXT NOT NULL,
  since TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 2),
  PRIMARY KEY (member_id, factor),
  CONSTRAINT health_working_on_member_id_position_key UNIQUE (member_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "health_working_on_cheer" (
  member_id TEXT NOT NULL REFERENCES hosted_member(id) ON DELETE CASCADE ON UPDATE CASCADE,
  owner_id TEXT NOT NULL,
  factor TEXT NOT NULL,
  PRIMARY KEY (member_id, owner_id, factor),
  FOREIGN KEY (owner_id, factor) REFERENCES health_working_on(member_id, factor) ON DELETE CASCADE ON UPDATE CASCADE,
  CHECK (owner_id <> member_id)
);
CREATE INDEX health_working_on_cheer_owner_id_factor_idx ON health_working_on_cheer(owner_id, factor);
