import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import pg from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresMigrationProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260904190000_linq_email_handle_identity/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

if (
  runPostgresMigrationProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The Linq email-handle identity migration proof requires a local DATABASE_URL.",
  );
}

describe("Linq email-handle identity migration contract", () => {
  it("backfills identity only and never creates signup or usage grants", () => {
    expect(migrationSql).toContain('ADD COLUMN "linq_email_handle_lookup_key" TEXT');
    expect(migrationSql).toContain("CREATE UNIQUE INDEX");
    expect(migrationSql).toContain("pending_linq_participant_contact_lookup_key");
    expect(migrationSql).not.toMatch(/hosted_(?:invite|usage_credit|starter)/u);
    expect(migrationSql).not.toContain("verified_email_verified_at");
  });
});

describe.skipIf(!runPostgresMigrationProof)(
  "Linq email-handle identity migration with PostgreSQL",
  () => {
    it("backfills one durable handle from active and pending email routes", async () => {
      await withFixtureSchema(async (client) => {
        await client.query(`
          INSERT INTO "hosted_member_identity" ("member_id")
          VALUES ('member_email');
          INSERT INTO "hosted_member_routing" (
            "member_id",
            "linq_participant_contact_kind",
            "linq_participant_contact_lookup_key",
            "pending_linq_participant_contact_kind",
            "pending_linq_participant_contact_lookup_key"
          ) VALUES (
            'member_email',
            'email',
            'email-key',
            'email',
            'email-key'
          );
        `);

        await applyMigration(client);

        await expect(client.query(
          "SELECT to_regclass('pg_temp.linq_email_identity_backfill') AS scratch",
        )).resolves.toMatchObject({ rows: [{ scratch: null }] });

        await expect(client.query<{ lookupKey: string | null }>(`
          SELECT "linq_email_handle_lookup_key" AS "lookupKey"
          FROM "hosted_member_identity"
          WHERE "member_id" = 'member_email'
        `)).resolves.toMatchObject({
          rows: [{ lookupKey: "email-key" }],
        });
        await expect(client.query(`
          INSERT INTO "hosted_member_identity" (
            "member_id",
            "linq_email_handle_lookup_key"
          ) VALUES ('member_other', 'email-key')
        `)).rejects.toMatchObject({ code: "23505" });
      });
    });

    it("rejects a handle routed to multiple members", async () => {
      await withFixtureSchema(async (client) => {
        await client.query(`
          INSERT INTO "hosted_member_identity" ("member_id")
          VALUES ('member_one'), ('member_two');
          INSERT INTO "hosted_member_routing" (
            "member_id",
            "pending_linq_participant_contact_kind",
            "pending_linq_participant_contact_lookup_key"
          ) VALUES
            ('member_one', 'email', 'shared-key'),
            ('member_two', 'email', 'shared-key');
        `);

        await expect(applyMigration(client)).rejects.toThrow(
          "one handle belongs to multiple members",
        );
      });
    });

    it("rejects a route whose verified email belongs to another member", async () => {
      await withFixtureSchema(async (client) => {
        await client.query(`
          INSERT INTO "hosted_member_identity" ("member_id")
          VALUES ('member_route'), ('member_verified');
          INSERT INTO "hosted_member_routing" (
            "member_id",
            "pending_linq_participant_contact_kind",
            "pending_linq_participant_contact_lookup_key"
          ) VALUES ('member_route', 'email', 'conflict-key');
          INSERT INTO "hosted_member_email_authorization" (
            "member_id",
            "verified_email_lookup_key"
          ) VALUES ('member_verified', 'conflict-key');
        `);

        await expect(applyMigration(client)).rejects.toThrow(
          "verified email belongs to another member",
        );
      });
    });

    it("rejects different active and pending handles on one member", async () => {
      await withFixtureSchema(async (client) => {
        await client.query(`
          INSERT INTO "hosted_member_identity" ("member_id") VALUES ('member_one');
          INSERT INTO "hosted_member_routing" (
            "member_id", "linq_participant_contact_kind",
            "linq_participant_contact_lookup_key",
            "pending_linq_participant_contact_kind",
            "pending_linq_participant_contact_lookup_key"
          ) VALUES ('member_one', 'email', 'active-key', 'email', 'pending-key');
        `);
        await expect(applyMigration(client)).rejects.toThrow(
          "one member has multiple handles",
        );
      });
    });

    it("rejects an email route without an identity owner", async () => {
      await withFixtureSchema(async (client) => {
        await client.query(`
          INSERT INTO "hosted_member_routing" (
            "member_id", "pending_linq_participant_contact_kind",
            "pending_linq_participant_contact_lookup_key"
          ) VALUES ('member_missing', 'email', 'orphan-key');
        `);
        await expect(applyMigration(client)).rejects.toThrow(
          "a route owner has no identity row",
        );
      });
    });
  },
);

async function applyMigration(client: pg.Client): Promise<void> {
  try {
    await client.query(migrationSql);
  } catch (error) {
    await client.query("ROLLBACK");
    await expect(client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'hosted_member_identity'
        AND column_name = 'linq_email_handle_lookup_key'
    `)).resolves.toMatchObject({ rows: [] });
    await expect(client.query(
      "SELECT to_regclass('pg_temp.linq_email_identity_backfill') AS scratch",
    )).resolves.toMatchObject({ rows: [{ scratch: null }] });
    throw error;
  }
}

async function withFixtureSchema(
  run: (client: pg.Client) => Promise<void>,
): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  const schemaName = `linq_email_identity_${randomUUID().replaceAll("-", "_")}`;
  const quotedSchemaName = `"${schemaName}"`;
  await client.connect();

  try {
    await client.query(`CREATE SCHEMA ${quotedSchemaName}`);
    await client.query(`SET search_path TO ${quotedSchemaName}, public`);
    await client.query(`
      CREATE TABLE "hosted_member_identity" (
        "member_id" TEXT PRIMARY KEY
      );
      CREATE TABLE "hosted_member_routing" (
        "member_id" TEXT PRIMARY KEY,
        "linq_participant_contact_kind" TEXT,
        "linq_participant_contact_lookup_key" TEXT,
        "pending_linq_participant_contact_kind" TEXT,
        "pending_linq_participant_contact_lookup_key" TEXT
      );
      CREATE TABLE "hosted_member_email_authorization" (
        "member_id" TEXT PRIMARY KEY,
        "verified_email_lookup_key" TEXT UNIQUE
      );
    `);
    await run(client);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${quotedSchemaName} CASCADE`);
    await client.end();
  }
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:")
      && ["127.0.0.1", "::1", "localhost"].includes(parsed.hostname);
  } catch {
    return false;
  }
}
