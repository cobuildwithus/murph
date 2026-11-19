-- A town's postcard story shares the place art table: its JSON is the row's bytes. Widening only,
-- so older code keeps working, and the check stays widened on rollback while story rows exist.
ALTER TABLE "game_place_art" DROP CONSTRAINT "game_place_art_kind_check";
ALTER TABLE "game_place_art" ADD CONSTRAINT "game_place_art_kind_check" CHECK ("kind" IN ('poster', 'map', 'story'));
