import { readFile } from "node:fs/promises";

import pg from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const contractMigrationUrl = new URL(
  "../prisma/contract-migrations/20260910200000_require_device_payload_credential_classification/migration.sql",
  import.meta.url,
);

if (runPostgresProof && !isClearlyLocalPostgresUrl(databaseUrl)) {
  throw new Error("The device payload contract proof requires a local DATABASE_URL.");
}

describe.skipIf(!runPostgresProof)("device payload classification contract migration", () => {
  it("preserves both classifications and accepts explicit current writes", async () => {
    await withPayloadTable(async (client, contractSql) => {
      await client.query(`
        INSERT INTO "device_sync_dirty_payload" VALUES
          ('retained-independent', true), ('retained-scoped', false)
      `);
      await client.query(contractSql);
      await client.query(`
        INSERT INTO "device_sync_dirty_payload" VALUES
          ('new-independent', true), ('new-scoped', false)
      `);
      const result = await client.query(`
        SELECT id, credential_independent FROM "device_sync_dirty_payload" ORDER BY id
      `);
      expect(result.rows).toEqual([
        { id: "new-independent", credential_independent: true },
        { id: "new-scoped", credential_independent: false },
        { id: "retained-independent", credential_independent: true },
        { id: "retained-scoped", credential_independent: false },
      ]);
    });
  });

  it.each([
    ["an omitted classification", `INSERT INTO "device_sync_dirty_payload" (id) VALUES ('omitted')`],
    ["an explicit null insert", `INSERT INTO "device_sync_dirty_payload" VALUES ('null-insert', NULL)`],
    ["a null update", 'UPDATE "device_sync_dirty_payload" SET credential_independent = NULL'],
  ])("rejects %s after contraction", async (_description, query) => {
    await withPayloadTable(async (client, contractSql) => {
      await client.query(`INSERT INTO "device_sync_dirty_payload" VALUES ('existing', false)`);
      await client.query(contractSql);
      await expect(client.query(query)).rejects.toMatchObject({ code: "23502" });
    });
  });

  it("fails atomically on restored unclassified rows without inventing authority", async () => {
    await withPayloadTable(async (client, contractSql) => {
      await client.query(`INSERT INTO "device_sync_dirty_payload" VALUES ('restored-null', NULL)`);
      await expect(client.query(contractSql)).rejects.toMatchObject({ code: "23502" });
      const result = await client.query(`
        SELECT id, credential_independent FROM "device_sync_dirty_payload"
      `);
      expect(result.rows).toEqual([{ id: "restored-null", credential_independent: null }]);
      const column = await client.query(`
        SELECT attnotnull FROM pg_attribute
        WHERE attrelid = 'pg_temp.device_sync_dirty_payload'::regclass
          AND attname = 'credential_independent'
      `);
      expect(column.rows).toEqual([{ attnotnull: false }]);
    });
  });
});

async function withPayloadTable(
  run: (client: pg.Client, contractSql: string) => Promise<void>,
): Promise<void> {
  const contractSql = await readFile(contractMigrationUrl, "utf8");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`
      CREATE TEMP TABLE "device_sync_dirty_payload" (
        id TEXT PRIMARY KEY,
        credential_independent BOOLEAN
      )
    `);
    await run(client, contractSql);
  } finally {
    await client.end();
  }
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol.startsWith("postgres")
      && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}
