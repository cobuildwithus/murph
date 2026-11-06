CREATE INDEX CONCURRENTLY "game_event_actor_type_idx"
  ON "game_event"("actor", "type");
