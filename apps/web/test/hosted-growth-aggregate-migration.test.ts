import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { Client } from "pg";
import { describe, expect, it } from "vitest";

const schema = readFileSync(
  new URL("../prisma/schema.prisma", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL(
    "../prisma/migrations/20260726120000_hosted_growth_aggregate/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof &&
  (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The growth aggregate migration proof requires a local DATABASE_URL.",
  );
}

describe("hosted growth aggregate migration", () => {
  it("creates and atomically cuts over one anonymous nonnegative tracked counter", () => {
    expect(schema).toContain("model HostedGrowthAggregate");
    expect(schema).toContain("trackedFulfilledUsageTopUps");
    expect(migration).toMatch(/^BEGIN;/u);
    expect(migration).toContain(
      'LOCK TABLE "hosted_usage_credit_purchase" IN SHARE ROW EXCLUSIVE MODE',
    );
    expect(migration).toContain('CREATE TABLE "hosted_growth_aggregate"');
    expect(migration).toContain('CHECK ("id" = \'global\')');
    expect(migration).toContain(
      'CHECK ("tracked_fulfilled_usage_top_ups" >= 0)',
    );
    expect(migration).toContain("COUNT(*)::INTEGER");
    expect(migration).toContain('WHERE "status" = \'fulfilled\'');
    expect(migration).toContain(
      'CREATE TRIGGER "hosted_usage_credit_purchase_growth_total"',
    );
    expect(migration).toContain('AFTER UPDATE OF "status"');
    expect(migration).toContain(
      'OLD."status" IS DISTINCT FROM \'fulfilled\'',
    );
    expect(migration).toContain('NEW."status" = \'fulfilled\'');
    expect(migration).toMatch(/COMMIT;\s*$/u);
  });

  it("stores no member, purchase, provider, event, or timing reference", () => {
    expect(migration).not.toMatch(
      /member|payer|beneficiary|purchase_id|stripe|event|timestamp|updated_at|created_at/iu,
    );
  });
});

describe.skipIf(!runPostgresProof)(
  "hosted growth aggregate PostgreSQL cutover",
  () => {
    it("truthfully omits deleted pre-cutover history and preserves tracked post-cutover fulfillments", async () => {
      const schemaName = `growth_cutover_${randomUUID().replaceAll("-", "")}`;
      const client = new Client({ connectionString: databaseUrl });

      await client.connect();
      try {
        await client.query(`CREATE SCHEMA "${schemaName}"`);
        await client.query(`SET search_path TO "${schemaName}"`);
        await client.query(`
          CREATE TABLE "hosted_usage_credit_purchase" (
            "id" TEXT PRIMARY KEY,
            "status" TEXT NOT NULL
          )
        `);
        await client.query(`
          INSERT INTO "hosted_usage_credit_purchase" ("id", "status")
          VALUES ('deleted-before-cutover', 'fulfilled')
        `);
        await client.query(`
          DELETE FROM "hosted_usage_credit_purchase"
          WHERE "id" = 'deleted-before-cutover'
        `);

        await client.query(migration);

        await expect(readTrackedFulfilledTopUps(client)).resolves.toBe(0);

        await client.query(`
          INSERT INTO "hosted_usage_credit_purchase" ("id", "status")
          VALUES ('fulfilled-after-cutover', 'created')
        `);
        await client.query("BEGIN");
        await client.query(`
          UPDATE "hosted_usage_credit_purchase"
          SET "status" = 'fulfilled'
          WHERE "id" = 'fulfilled-after-cutover'
        `);
        await client.query("ROLLBACK");
        await expect(readTrackedFulfilledTopUps(client)).resolves.toBe(0);

        await client.query(`
          UPDATE "hosted_usage_credit_purchase"
          SET "status" = 'fulfilled'
          WHERE "id" = 'fulfilled-after-cutover'
        `);
        await client.query(`
          UPDATE "hosted_usage_credit_purchase"
          SET "status" = 'fulfilled'
          WHERE "id" = 'fulfilled-after-cutover'
        `);
        await expect(readTrackedFulfilledTopUps(client)).resolves.toBe(1);

        await client.query(`
          DELETE FROM "hosted_usage_credit_purchase"
          WHERE "id" = 'fulfilled-after-cutover'
        `);
        await expect(readTrackedFulfilledTopUps(client)).resolves.toBe(1);
      } finally {
        await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
        await client.end();
      }
    });
  },
);

async function readTrackedFulfilledTopUps(client: Client): Promise<number> {
  const result = await client.query<{
    tracked_fulfilled_usage_top_ups: number;
  }>(`
    SELECT "tracked_fulfilled_usage_top_ups"
    FROM "hosted_growth_aggregate"
    WHERE "id" = 'global'
  `);
  const value = result.rows[0]?.tracked_fulfilled_usage_top_ups;
  if (typeof value !== "number") {
    throw new Error("Expected the tracked growth aggregate singleton.");
  }
  return value;
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    return false;
  }
  const hostOverrides = parsed.searchParams.getAll("host");
  if (hostOverrides.length > 1) {
    return false;
  }
  const effectiveHost = (hostOverrides[0] || parsed.hostname).toLowerCase();
  return ["127.0.0.1", "::1", "[::1]", "localhost"].includes(effectiveHost)
    || effectiveHost.startsWith("/");
}
