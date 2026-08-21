import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import pg from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresMigrationProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260820020000_hosted_signup_notification_context/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

if (
  runPostgresMigrationProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The signup-notification context migration proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresMigrationProof)(
  "signup-notification context migration with PostgreSQL",
  () => {
    it("clears pending ciphertext for legacy attempt-only claims and later writes", async () => {
      const client = new pg.Client({ connectionString: databaseUrl });
      const schemaName = `signup_notification_${randomUUID().replaceAll("-", "_")}`;
      const quotedSchemaName = `"${schemaName}"`;
      await client.connect();

      try {
        await client.query("SET TIME ZONE 'UTC'");
        await client.query(`CREATE SCHEMA ${quotedSchemaName}`);
        await client.query(`SET search_path TO ${quotedSchemaName}, public`);
        await client.query(`
          CREATE TABLE "hosted_member" (
            "id" TEXT PRIMARY KEY,
            "signup_notification_email_attempted_at" TIMESTAMP(3)
          );

          INSERT INTO "hosted_member" (
            "id",
            "signup_notification_email_attempted_at"
          ) VALUES ('member_fixture', NULL);
        `);
        await client.query(migrationSql);
        await client.query(`
          UPDATE "hosted_member"
          SET "signup_notification_context_encrypted" = 'encrypted-context'
          WHERE "id" = 'member_fixture';

          UPDATE "hosted_member"
          SET "signup_notification_email_attempted_at" = '2026-08-20T20:00:00.000'
          WHERE "id" = 'member_fixture';
        `);

        await expect(readFixture(client)).resolves.toEqual({
          attemptedAt: new Date("2026-08-20T20:00:00.000Z"),
          encryptedContext: null,
        });

        await client.query(`
          UPDATE "hosted_member"
          SET "signup_notification_context_encrypted" = 'late-context'
          WHERE "id" = 'member_fixture';
        `);

        await expect(readFixture(client)).resolves.toEqual({
          attemptedAt: new Date("2026-08-20T20:00:00.000Z"),
          encryptedContext: null,
        });
      } finally {
        await client.query(`DROP SCHEMA IF EXISTS ${quotedSchemaName} CASCADE`);
        await client.end();
      }
    });
  },
);

async function readFixture(client: pg.Client): Promise<{
  attemptedAt: Date | null;
  encryptedContext: string | null;
}> {
  const result = await client.query<{
    attemptedAt: Date | null;
    encryptedContext: string | null;
  }>(`
    SELECT
      "signup_notification_email_attempted_at" AS "attemptedAt",
      "signup_notification_context_encrypted" AS "encryptedContext"
    FROM "hosted_member"
    WHERE "id" = 'member_fixture'
  `);
  const row = result.rows[0];
  if (!row) {
    throw new Error("Expected signup-notification context fixture row.");
  }
  return row;
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "postgres:" || url.protocol === "postgresql:"
      ? url.hostname === "127.0.0.1"
        || url.hostname === "localhost"
        || url.hostname === "::1"
      : false;
  } catch {
    return false;
  }
}
