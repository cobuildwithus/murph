import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../prisma/migrations/20261016180000_weekly_game/migration.sql", import.meta.url),
  "utf8",
);

describe("weekly game schema", () => {
  it("lets the database keep the same people to one live game together, and enforce the per-day caps", () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "game_live_roster_key_key" ON "game"("live_roster_key");');
    expect(migration).toContain('CHECK (("live_roster_key" IS NULL) = ("status" <> \'live\'))');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "game_entry_game_id_member_id_day_index_attempt_key" ON "game_entry"("game_id", "member_id", "day_index", "attempt");',
    );
    expect(migration).toContain(
      'CHECK ("kind" IN (\'photo\', \'excuse\') AND "attempt" BETWEEN 0 AND 2 AND ("attempt" = 0) = ("kind" = \'excuse\'))',
    );
    expect(migration).toContain('CREATE UNIQUE INDEX "game_invite_token_hash_key" ON "game"("invite_token_hash");');
  });

  it("stores people's words only in encrypted columns", () => {
    expect(migration).not.toMatch(/"(first_name|name|relationship|text|data|what|item|task|invite_token|terms_words)" (TEXT|JSONB)/u);
    for (const column of [
      "first_name_encrypted",
      "name_encrypted",
      "relationship_encrypted",
      "text_encrypted",
      "terms_words_encrypted",
      "invite_token_encrypted",
    ]) {
      expect(migration).toContain(`"${column}" TEXT`);
    }
  });
});


it("prepares all v1 artifact storage and preserves legacy lengths and attempt caps", () => {
  const sql = readFileSync(new URL("../prisma/migrations/20261022220000_game_v1/migration.sql", import.meta.url), "utf8");
  expect(sql).toContain('CHECK ("length_days" BETWEEN 1 AND 365) NOT VALID');
  expect(sql).toContain("'photo', 'heart_rate', 'words', 'route', 'reps', 'excuse'");
  expect(sql).toContain('AND "attempt" BETWEEN 0 AND 2');
  expect(sql).toContain('ADD COLUMN "payload_encrypted" TEXT;');
  expect(sql).toContain('ADD COLUMN "blur_hash" TEXT;');
  const transactions = sql.split("COMMIT;");
  expect(transactions[0]).not.toContain("VALIDATE CONSTRAINT");
  expect(transactions[1]).toContain('VALIDATE CONSTRAINT "game_length_days_check"');
  expect(transactions[1]).toContain('VALIDATE CONSTRAINT "game_entry_attempt_check"');
});
