-- A town's postcard story shares the place art table: its JSON is the row's bytes. Only widens the
-- kind set; old rows and old writers stay valid. Replace atomically with NOT VALID, then validate
-- without the metadata lock.
ALTER TABLE "game_place_art"
  DROP CONSTRAINT "game_place_art_kind_check",
  ADD CONSTRAINT "game_place_art_kind_check" CHECK ("kind" IN ('poster', 'map', 'story')) NOT VALID;
ALTER TABLE "game_place_art"
  VALIDATE CONSTRAINT "game_place_art_kind_check";
