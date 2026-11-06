-- Owner-approved direct cutover: old Web game routes are unavailable until the
-- schema-aware Web deploy is live. No old/new writer compatibility is intended.
BEGIN;
LOCK TABLE game, game_player, game_entry, game_ticket IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM game WHERE departed_player IS NOT NULL AND departed_player <> 'null'::jsonb) THEN
    RAISE EXCEPTION 'Game storage cutover cannot classify a legacy departure';
  END IF;
  IF EXISTS (SELECT 1 FROM game WHERE created_by IS NULL) THEN
    -- Without the original owner, SQL cannot authenticate or reseal ciphertext.
    RAISE EXCEPTION 'Game storage cutover requires a proven ciphertext owner';
  END IF;
  IF EXISTS (SELECT 1 FROM game_ticket t
    LEFT JOIN game_player debtor ON debtor.game_id = t.game_id AND debtor.member_id = t.owed_by
    LEFT JOIN game_player holder ON holder.game_id = t.game_id AND holder.member_id = t.owed_to
    WHERE debtor.seat IS NULL OR holder.seat IS NULL) THEN
    RAISE EXCEPTION 'Game storage cutover cannot classify a ticket party';
  END IF;
END $$;

ALTER TABLE game ADD COLUMN max_players INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN audience_key TEXT,
  ADD COLUMN words_owner_member_id TEXT;
UPDATE game SET words_owner_member_id = created_by;
ALTER TABLE game ALTER COLUMN words_owner_member_id SET NOT NULL,
  ADD CONSTRAINT game_max_players_check CHECK (max_players IN (2, 10)),
  DROP CONSTRAINT game_created_by_fkey,
  ADD CONSTRAINT game_created_by_fkey FOREIGN KEY (created_by) REFERENCES game_profile(member_id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT game_words_owner_member_id_fkey FOREIGN KEY (words_owner_member_id) REFERENCES game_profile(member_id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX game_audience_key_status_idx ON game(audience_key, status);
CREATE INDEX game_words_owner_member_id_idx ON game(words_owner_member_id);

CREATE TABLE game_invitee (
  game_id TEXT NOT NULL REFERENCES game(id) ON DELETE CASCADE ON UPDATE CASCADE,
  seat INTEGER NOT NULL CHECK (seat BETWEEN 1 AND 9),
  member_id TEXT REFERENCES hosted_member(id) ON DELETE SET NULL ON UPDATE CASCADE,
  recipient_lookup_key TEXT,
  pending_label JSONB,
  PRIMARY KEY (game_id, seat)
);
CREATE UNIQUE INDEX game_invitee_game_id_member_id_key ON game_invitee(game_id, member_id);
CREATE UNIQUE INDEX game_invitee_game_id_recipient_lookup_key_key ON game_invitee(game_id, recipient_lookup_key);
CREATE INDEX game_invitee_member_id_game_id_idx ON game_invitee(member_id, game_id);
CREATE INDEX game_invitee_recipient_lookup_key_game_id_idx ON game_invitee(recipient_lookup_key, game_id);
-- Label AAD is bound to its creator, not the shared words owner. Preserve bytes.
INSERT INTO game_invitee (game_id, seat, member_id, pending_label)
SELECT id, 1, invitee_member_id, pending_label FROM game
WHERE invitee_member_id IS NOT NULL OR (pending_label IS NOT NULL AND pending_label <> 'null'::jsonb);

ALTER TABLE game_entry DROP CONSTRAINT game_entry_game_id_member_id_fkey;
ALTER TABLE game_player DROP CONSTRAINT game_player_pkey;
DROP INDEX game_player_game_id_seat_key;
ALTER TABLE game_player ADD PRIMARY KEY (game_id, seat),
  ALTER COLUMN member_id DROP NOT NULL,
  ALTER COLUMN time_zone DROP NOT NULL,
  ALTER COLUMN joined_at DROP NOT NULL,
  ALTER COLUMN joined_at DROP DEFAULT,
  ADD COLUMN left_at TIMESTAMP(3),
  ADD COLUMN departed_label JSONB,
  DROP CONSTRAINT game_player_member_id_fkey,
  ADD CONSTRAINT game_player_member_id_fkey FOREIGN KEY (member_id) REFERENCES game_profile(member_id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT game_player_seat_check CHECK (seat BETWEEN 0 AND 18),
  ADD CONSTRAINT game_player_participation_check CHECK (
    (member_id IS NULL AND left_at IS NOT NULL) OR
    (member_id IS NOT NULL AND joined_at IS NOT NULL AND time_zone IS NOT NULL));
CREATE UNIQUE INDEX game_player_game_id_member_id_key ON game_player(game_id, member_id);
ALTER TABLE game_entry ADD CONSTRAINT game_entry_game_id_member_id_fkey
  FOREIGN KEY (game_id, member_id) REFERENCES game_player(game_id, member_id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE game_ticket ADD COLUMN owed_by_seats INTEGER[], ADD COLUMN owed_to_seats INTEGER[];
UPDATE game_ticket t SET owed_by_seats = ARRAY[debtor.seat], owed_to_seats = ARRAY[holder.seat]
FROM game_player debtor, game_player holder
WHERE debtor.game_id = t.game_id AND debtor.member_id = t.owed_by
  AND holder.game_id = t.game_id AND holder.member_id = t.owed_to;
ALTER TABLE game_ticket ALTER COLUMN owed_by_seats SET NOT NULL, ALTER COLUMN owed_to_seats SET NOT NULL,
  ADD CONSTRAINT game_ticket_parties_check CHECK (
    cardinality(owed_by_seats) BETWEEN 1 AND 10 AND cardinality(owed_to_seats) BETWEEN 1 AND 10
    AND array_position(owed_by_seats, NULL) IS NULL AND array_position(owed_to_seats, NULL) IS NULL
    AND owed_by_seats <@ ARRAY[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18]
    AND owed_to_seats <@ ARRAY[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18]
    AND NOT owed_by_seats && owed_to_seats),
  DROP COLUMN owed_by, DROP COLUMN owed_to;
ALTER TABLE game DROP COLUMN invitee_member_id, DROP COLUMN pending_label, DROP COLUMN departed_player;
COMMIT;
