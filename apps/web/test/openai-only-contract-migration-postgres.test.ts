import { readFile } from "node:fs/promises";

import pg from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const migrationUrl = new URL(
  "../prisma/contract-migrations/20261007000000_remove_custom_inference/migration.sql",
  import.meta.url,
);

if (enabled) {
  const url = new URL(databaseUrl);
  if (
    url.protocol !== "postgresql:"
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || !url.pathname.startsWith("/murph_test")
  ) {
    throw new Error("OpenAI-only cleanup proof requires an isolated local test database.");
  }
}

describe.skipIf(!enabled)("OpenAI-only contract migration", () => {
  it("retires custom credentials and preferences while preserving member and runtime authority", async () => {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("BEGIN");
      // Restrict name resolution so even a repeated DROP cannot reach real tables.
      await client.query("SET LOCAL search_path = pg_temp");
      await client.query(`
        CREATE TEMP TABLE hosted_member (
          id TEXT PRIMARY KEY,
          assistant_provider_preference TEXT,
          assistant_model_preference TEXT
        );
        CREATE TEMP TABLE hosted_runtime_owner (
          user_id TEXT PRIMARY KEY,
          generation BIGINT NOT NULL,
          phase TEXT NOT NULL,
          provider_egress_token_hash TEXT,
          custom_inference_envelope TEXT
        );
        CREATE TEMP TABLE hosted_inference_connection (
          member_id TEXT PRIMARY KEY REFERENCES hosted_member(id) ON DELETE CASCADE,
          config_encrypted TEXT NOT NULL
        );
        CREATE TEMP SEQUENCE hosted_inference_connection_revision_seq;
        INSERT INTO hosted_member VALUES
          ('member-retired-provider', 'venice', 'gpt-5'),
          ('member-openai', 'openai', 'gpt-5');
        INSERT INTO hosted_runtime_owner VALUES
          ('member-retired-provider', 7, 'idle', NULL, 'synthetic-envelope'),
          ('member-openai', 9, 'active', 'synthetic-token-hash', NULL);
        INSERT INTO hosted_inference_connection VALUES
          ('member-retired-provider', 'synthetic-encrypted-credentials');
      `);

      const migration = await readFile(migrationUrl, "utf8");
      await client.query(migration);
      // A retry must preserve the same surviving member and runtime state.
      await client.query(migration);

      expect((await client.query("SELECT * FROM hosted_member ORDER BY id")).rows).toEqual([
        { id: "member-openai", assistant_model_preference: "gpt-5" },
        { id: "member-retired-provider", assistant_model_preference: "gpt-5" },
      ]);
      expect((await client.query("SELECT * FROM hosted_runtime_owner ORDER BY user_id")).rows).toEqual([
        {
          user_id: "member-openai",
          generation: "9",
          phase: "active",
          provider_egress_token_hash: "synthetic-token-hash",
        },
        {
          user_id: "member-retired-provider",
          generation: "7",
          phase: "idle",
          provider_egress_token_hash: null,
        },
      ]);
      expect((await client.query(`
        SELECT
          to_regclass('pg_temp.hosted_inference_connection') AS connection,
          to_regclass('pg_temp.hosted_inference_connection_revision_seq') AS revision_sequence
      `)).rows).toEqual([{ connection: null, revision_sequence: null }]);
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  });
});
