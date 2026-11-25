import { randomUUID } from "node:crypto";
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
  it("preserves historical health withdrawals and resets messages from legacy grant writers", async () => {
    const client = new pg.Client({ connectionString: databaseUrl });
    const schema = `"clinical_preference_${randomUUID()}"`;
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`
        CREATE TABLE hosted_member (id TEXT PRIMARY KEY);
        CREATE TABLE hosted_consent_grant (member_id TEXT, scope TEXT, status TEXT);
        CREATE TABLE hosted_consent_event (member_id TEXT, scope TEXT, action TEXT);
        INSERT INTO hosted_member VALUES ('current'), ('withdrawn'), ('renewed');
        INSERT INTO hosted_consent_grant VALUES
          ('current', 'launch.health-data', 'granted'), ('withdrawn', 'launch.health-data', 'revoked'),
          ('renewed', 'launch.health-data', 'granted');
        INSERT INTO hosted_consent_event VALUES ('renewed', 'launch.health-data', 'revoked');
      `);
      await client.query(await readFile(new URL(
        "../prisma/migrations/20261125120000_clinical_record_message_mode/migration.sql", import.meta.url,
      ), "utf8"));
      await client.query(await readFile(new URL(
        "../prisma/migrations/20261125120100_clinical_record_message_withdrawals/migration.sql", import.meta.url,
      ), "utf8"));
      const rows = async () => (await client.query(`
        SELECT id, clinical_record_message_mode AS mode, clinical_record_message_revision AS revision
        FROM hosted_member ORDER BY id
      `)).rows;
      expect(await rows()).toEqual([
        { id: "current", mode: "notice", revision: 0 }, { id: "renewed", mode: "off", revision: 1 },
        { id: "withdrawn", mode: "off", revision: 1 },
      ]);
      await client.query("INSERT INTO hosted_member (id) VALUES ('new')");
      await client.query("UPDATE hosted_consent_grant SET status = 'revoked' WHERE member_id = 'current'");
      await client.query("UPDATE hosted_consent_grant SET status = 'granted' WHERE member_id = 'current'");
      expect(await rows()).toEqual([
        { id: "current", mode: "off", revision: 1 }, { id: "new", mode: "notice", revision: 0 },
        { id: "renewed", mode: "off", revision: 1 }, { id: "withdrawn", mode: "off", revision: 1 },
      ]);
    } finally {
      try {
        await client.query("ROLLBACK");
        await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      } finally {
        await client.end();
      }
    }
  });

  it("allows old browser writers alongside closed native return bindings", async () => {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query("CREATE TEMP TABLE clinical_record_oauth_session (connect_intent_claim_hash TEXT NOT NULL)");
      const browserInsert = "INSERT INTO clinical_record_oauth_session (connect_intent_claim_hash) VALUES ('synthetic-claim')";
      await client.query(browserInsert);
      await client.query(await readFile(new URL(
        "../prisma/migrations/20261124120000_clinical_native_return/migration.sql", import.meta.url,
      ), "utf8"));
      await client.query(browserInsert);
      await client.query("INSERT INTO clinical_record_oauth_session (app_return) VALUES ('ios'), ('ios-dev')");
      expect((await client.query("SELECT 1 FROM clinical_record_oauth_session WHERE app_return IS NULL")).rowCount).toBe(2);
      for (const pair of [[null, null], ["claim", "ios"], [null, "other"]]) {
        await client.query("SAVEPOINT invalid_pair");
        await expect(client.query("INSERT INTO clinical_record_oauth_session VALUES ($1, $2)", pair)).rejects.toMatchObject({ code: "23514" });
        await client.query("ROLLBACK TO SAVEPOINT invalid_pair");
      }
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  });

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
