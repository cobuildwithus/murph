-- A game push address is usable only while its registering native session lives.
ALTER TABLE "companion_push_route" ADD COLUMN "game_session_id" TEXT;
