import { readFile } from "node:fs/promises";

import pg from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !/^\/murph_test(?:_[a-z0-9_]+)?$/u.test(url.pathname)
    || url.search || url.hash) {
    throw new Error("Clinical state migration proof requires a loopback murph_test database.");
  }
}

describe.skipIf(!enabled)("clinical state cleanup migrations", () => {
  it("normalizes historical phases and preserves receipts through old and new writers", async () => {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`
        CREATE TEMP TABLE clinical_record_retrieval_run (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          imported_count INTEGER NOT NULL DEFAULT 0,
          review_count INTEGER NOT NULL DEFAULT 0,
          outcome_counts_json JSONB
        );
        INSERT INTO clinical_record_retrieval_run VALUES
          ('active', 'importing', 0, 0, NULL),
          ('complete', 'complete', 4, 1, '{"createdCount":4,"reviewDecisionCount":1}'),
          ('reauth', 'needs_reauth', 2, 0, '{"createdCount":2,"reviewDecisionCount":0}');
      `);
      await client.query(await readFile(new URL(
        "../prisma/migrations/20261111000000_normalize_clinical_retrieval_phase/migration.sql",
        import.meta.url,
      ), "utf8"));
      expect((await client.query("SELECT status FROM clinical_record_retrieval_run WHERE id = 'active'")).rows)
        .toEqual([{ status: "retrieving" }]);
      // An old in-flight function can finish before the postdeploy drain.
      await client.query(`UPDATE clinical_record_retrieval_run SET status = 'complete',
        imported_count = 3, review_count = 1,
        outcome_counts_json = '{"createdCount":3,"reviewDecisionCount":1}' WHERE id = 'active'`);
      // New writers persist only the receipt while old scalar defaults remain.
      await client.query(`INSERT INTO clinical_record_retrieval_run (id, status, outcome_counts_json)
        VALUES ('new', 'complete', '{"createdCount":5,"reviewDecisionCount":2}')`);
      const before = (await client.query("SELECT id, status, outcome_counts_json FROM clinical_record_retrieval_run ORDER BY id")).rows;
      await client.query(await readFile(new URL(
        "../prisma/contract-migrations/20261111000100_drop_clinical_outcome_counter_copies/migration.sql",
        import.meta.url,
      ), "utf8"));
      expect((await client.query("SELECT * FROM clinical_record_retrieval_run ORDER BY id")).rows).toEqual(before);
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  });
});
