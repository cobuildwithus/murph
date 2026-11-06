import { readFile } from "node:fs/promises";
import pg from "pg";
import { expect, test } from "vitest";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

test.skipIf(!enabled)("media schema permits durable cold history, upload cleanup and account retirement", async () => {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.searchParams.has("host")) throw new Error("Migration proof requires loopback PostgreSQL.");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    // Session-local shadow: never alter the shared test database's real table.
    await client.query(`CREATE TEMP TABLE hosted_runtime_media (
      media_kind TEXT NOT NULL CHECK (media_kind IN ('image', 'video')),
      registered BOOLEAN NOT NULL DEFAULT false, expires_at TIMESTAMP(3), retired_at TIMESTAMP(3)
    )`);
    await client.query(await readFile(new URL("../prisma/migrations/20261102120000_hosted_cold_ingest_media/migration.sql", import.meta.url), "utf8"));
    await client.query(`INSERT INTO hosted_runtime_media VALUES
      ('image', true, now(), NULL), ('video', true, now(), NULL),
      ('integration-ingest', false, now(), NULL),
      ('integration-ingest', true, NULL, NULL),
      ('integration-ingest', true, now(), now())`);
    await expect(client.query("INSERT INTO hosted_runtime_media VALUES ('integration-ingest', true, now(), NULL)"))
      .rejects.toMatchObject({ code: "23514" });
    const result = await client.query("SELECT count(*)::int AS count FROM hosted_runtime_media WHERE registered AND retired_at IS NULL AND expires_at IS NULL");
    expect(result.rows).toEqual([{ count: 1 }]);
  } finally { await client.end(); }
});
