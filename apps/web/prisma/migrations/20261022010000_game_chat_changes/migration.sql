ALTER TABLE "game" ADD COLUMN "chat_container_member_id" TEXT,
  ADD COLUMN "pending_change" JSONB;
CREATE INDEX "game_chat_container_member_id_idx" ON "game" ("chat_container_member_id");
ALTER TABLE "game_event" ADD COLUMN "command_key" TEXT;
CREATE UNIQUE INDEX "game_event_command_key_key" ON "game_event" ("command_key");
ALTER TABLE "game" ADD CONSTRAINT "game_chat_container_member_id_fkey" FOREIGN KEY ("chat_container_member_id") REFERENCES "hosted_member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
