import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../prisma/migrations/20261016180000_weekly_game/migration.sql", import.meta.url),
  "utf8",
);

describe("weekly game schema", () => {
  it("lets the database enforce one live game per person and the per-day caps", () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "game_player_active_member_id_key" ON "game_player"("active_member_id");');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "game_entry_game_id_member_id_day_index_attempt_key" ON "game_entry"("game_id", "member_id", "day_index", "attempt");',
    );
    expect(migration).toContain('CHECK ("attempt" BETWEEN 0 AND 2 AND ("attempt" = 0) = ("kind" = \'excuse\'))');
    expect(migration).toContain('CHECK ("active_member_id" IS NULL OR "active_member_id" = "member_id")');
    expect(migration).toContain('CREATE UNIQUE INDEX "game_event_actor_id_request_id_key" ON "game_event"("actor_id", "request_id");');
    expect(migration).toContain('CREATE UNIQUE INDEX "game_invite_token_hash_key" ON "game"("invite_token_hash");');
  });

  it("stores people's words only in encrypted columns", () => {
    expect(migration).not.toMatch(/"(first_name|name|relationship|text|data|what|item|task|invite_token|terms_words)" (TEXT|JSONB)/u);
    for (const column of [
      "first_name_encrypted",
      "name_encrypted",
      "relationship_encrypted",
      "text_encrypted",
      "data_encrypted",
      "terms_words_encrypted",
      "invite_token_encrypted",
    ]) {
      expect(migration).toContain(`"${column}" TEXT`);
    }
  });
});
