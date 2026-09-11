import { readFile } from "node:fs/promises";
import pg from "pg";
import { describe, expect, it } from "vitest";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("Phone encrypted-only guard proof requires loopback PostgreSQL.");
}
const migration = new URL(
  "../prisma/migrations/20260910210000_require_hosted_phone_call_encrypted_private_content/migration.sql",
  import.meta.url,
);

const cases = [
  { label: "SQL null", brief: null, result: null, ciphertext: "sealed_brief", accepted: true },
  { label: "JSON null", brief: "null", result: "null", ciphertext: "sealed_brief", accepted: true },
  { label: "retained brief", brief: '{"synthetic":true}', result: null, ciphertext: "sealed_brief", accepted: false },
  { label: "retained result", brief: null, result: '{"synthetic":true}', ciphertext: "sealed_brief", accepted: false },
  { label: "JSON scalar", brief: "false", result: null, ciphertext: "sealed_brief", accepted: false },
  { label: "JSON array", brief: null, result: "[]", ciphertext: "sealed_brief", accepted: false },
  { label: "missing ciphertext", brief: null, result: null, ciphertext: null, accepted: false },
  { label: "empty ciphertext", brief: null, result: null, ciphertext: "", accepted: false },
];

describe.skipIf(!enabled)("phone encrypted-only predeploy guard", () => {
  it.each(cases)("validates retained rows and fences later writers: $label", async (fixture) => {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`CREATE TEMP TABLE hosted_phone_call (
        id text PRIMARY KEY, brief_json jsonb, result_json jsonb,
        brief_encrypted text, result_encrypted text
      )`);
      await client.query("INSERT INTO hosted_phone_call VALUES ('call_synthetic', $1, $2, $3, 'sealed_result')", [
        fixture.brief, fixture.result, fixture.ciphertext,
      ]);
      const sql = await readFile(migration, "utf8");
      if (!fixture.accepted) {
        await expect(client.query(sql)).rejects.toThrow();
        return;
      }
      await client.query(sql);
      expect((await client.query("SELECT brief_encrypted, result_encrypted FROM hosted_phone_call")).rows).toEqual([
        { brief_encrypted: "sealed_brief", result_encrypted: "sealed_result" },
      ]);
      await client.query("INSERT INTO hosted_phone_call VALUES ('call_current_writer', NULL, NULL, 'new_sealed_brief', NULL)");
      for (const update of [
        "brief_json = '{}'", "result_json = '{}'", "brief_encrypted = NULL", "brief_encrypted = ''",
      ]) {
        await client.query("SAVEPOINT rejected_writer");
        await expect(client.query(`UPDATE hosted_phone_call SET ${update}`)).rejects.toThrow();
        await client.query("ROLLBACK TO SAVEPOINT rejected_writer");
      }
      expect((await client.query("SELECT count(*)::int AS count FROM hosted_phone_call")).rows).toEqual([{ count: 2 }]);
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  });
});
