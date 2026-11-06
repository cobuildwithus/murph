import { readFile } from "node:fs/promises";
import pg from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(databaseUrl);
  if (url.protocol !== "postgresql:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/murph_test")) {
    throw new Error("Terra reset proof requires an isolated local test database.");
  }
}

describe.skipIf(!enabled)("Terra chat model reset", () => {
  it("clears every existing personal and group override while preserving reasoning and identity", async () => {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL search_path = pg_temp");
      await client.query(`CREATE TEMP TABLE hosted_member (
        id TEXT PRIMARY KEY, assistant_model_preference TEXT,
        assistant_reasoning_effort_preference TEXT, is_group BOOLEAN
      );
      INSERT INTO hosted_member VALUES
        ('personal', 'gpt-6.1-sol', 'high', false),
        ('room', 'gpt-6-luna', NULL, true),
        ('premium', 'gpt-6-astra', 'medium', false),
        ('default', NULL, NULL, false);`);
      const sql = await readFile(new URL("../prisma/migrations/20261026120000_reset_chat_models_to_terra/migration.sql", import.meta.url), "utf8");
      expect((await client.query(sql)).rowCount).toBe(3);
      expect((await client.query(sql)).rowCount).toBe(0);
      expect((await client.query("SELECT * FROM hosted_member ORDER BY id")).rows).toEqual([
        { id: "default", assistant_model_preference: null, assistant_reasoning_effort_preference: null, is_group: false },
        { id: "personal", assistant_model_preference: null, assistant_reasoning_effort_preference: "high", is_group: false },
        { id: "premium", assistant_model_preference: null, assistant_reasoning_effort_preference: "medium", is_group: false },
        { id: "room", assistant_model_preference: null, assistant_reasoning_effort_preference: null, is_group: true },
      ]);
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  });
});
