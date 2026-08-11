import { readFile } from "node:fs/promises";

import pg from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresMigrationProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const expandMigrationUrl = new URL(
  "../prisma/migrations/20260805230000_meal_photo_authority_revision/migration.sql",
  import.meta.url,
);
const contractMigrationUrl = new URL(
  "../prisma/contract-migrations/20260805233000_meal_photo_authority_invariants/migration.sql",
  import.meta.url,
);

if (
  runPostgresMigrationProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The meal-photo authority migration proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresMigrationProof)(
  "meal-photo authority expand and contract migrations",
  () => {
    it("executes the exact rollout and enforces active, prepared, and revoked shapes", async () => {
      const [expandSql, contractSql] = await Promise.all([
        readFile(expandMigrationUrl, "utf8"),
        readFile(contractMigrationUrl, "utf8"),
      ]);
      const client = new pg.Client({ connectionString: databaseUrl });
      await client.connect();

      try {
        await client.query("BEGIN");
        await client.query(`
          CREATE TEMP TABLE "hosted_meal_photo_capture_enrollment" (
            "id" TEXT PRIMARY KEY,
            "member_id" TEXT NOT NULL,
            "installation_id_hash" TEXT NOT NULL,
            "upload_token_hash" TEXT NOT NULL,
            "idempotency_secret_encrypted" TEXT NOT NULL,
            "expires_at" TIMESTAMP(3) NOT NULL,
            "revoked_at" TIMESTAMP(3),
            "revoke_reason" TEXT,
            "created_at" TIMESTAMP(3) NOT NULL,
            "updated_at" TIMESTAMP(3) NOT NULL
          );

          INSERT INTO "hosted_meal_photo_capture_enrollment" (
            "id",
            "member_id",
            "installation_id_hash",
            "upload_token_hash",
            "idempotency_secret_encrypted",
            "expires_at",
            "revoked_at",
            "revoke_reason",
            "created_at",
            "updated_at"
          )
          VALUES
            (
              'active-before-expand',
              'member-active',
              'installation-active',
              'token-active',
              'secret-active',
              '2026-09-01 00:00:00',
              NULL,
              NULL,
              '2026-08-01 00:00:00',
              '2026-08-01 00:00:00'
            ),
            (
              'revoked-before-expand',
              'member-revoked',
              'installation-revoked',
              'token-revoked',
              'secret-revoked',
              '2026-09-01 00:00:00',
              '2026-08-02 00:00:00',
              'legacy-revoked',
              '2026-08-01 00:00:00',
              '2026-08-02 00:00:00'
            );
        `);

        await client.query(expandSql);

        // Simulate the final old-Web write after expand but before the fleet
        // drains. Omitted additive columns must keep their rollout defaults.
        await client.query(`
          INSERT INTO "hosted_meal_photo_capture_enrollment" (
            "id",
            "member_id",
            "installation_id_hash",
            "upload_token_hash",
            "idempotency_secret_encrypted",
            "expires_at",
            "revoked_at",
            "revoke_reason",
            "created_at",
            "updated_at"
          )
          VALUES (
            'active-legacy-window',
            'member-legacy',
            'installation-legacy',
            'token-legacy',
            'secret-legacy',
            '2026-09-01 00:00:00',
            NULL,
            NULL,
            '2026-08-03 00:00:00',
            '2026-08-03 00:00:00'
          )
        `);

        await client.query(contractSql);

        const rows = await client.query<{
          activated: boolean;
          authorityRevision: number;
          credentials: string;
          id: string;
        }>(`
          SELECT
            "id",
            "authority_revision" AS "authorityRevision",
            "activated_at" IS NOT NULL AS "activated",
            CASE
              WHEN "upload_token_hash" IS NOT NULL
                AND "idempotency_secret_encrypted" IS NOT NULL
                AND "expires_at" IS NOT NULL
                THEN 'complete'
              WHEN "upload_token_hash" IS NULL
                AND "idempotency_secret_encrypted" IS NULL
                AND "expires_at" IS NULL
                THEN 'empty'
              ELSE 'partial'
            END AS "credentials"
          FROM "hosted_meal_photo_capture_enrollment"
          ORDER BY "id"
        `);
        expect(rows.rows).toEqual([
          {
            activated: true,
            authorityRevision: 0,
            credentials: "complete",
            id: "active-before-expand",
          },
          {
            activated: true,
            authorityRevision: 0,
            credentials: "complete",
            id: "active-legacy-window",
          },
          {
            activated: false,
            authorityRevision: 0,
            credentials: "empty",
            id: "revoked-before-expand",
          },
        ]);

        const constraints = await client.query<{
          name: string;
          validated: boolean;
        }>(`
          SELECT "conname" AS "name", "convalidated" AS "validated"
          FROM "pg_constraint"
          WHERE "conrelid" = 'pg_temp.hosted_meal_photo_capture_enrollment'::regclass
            AND "conname" LIKE 'hosted_meal_photo_capture_enrollment_%_check'
          ORDER BY "conname"
        `);
        expect(constraints.rows).toEqual([
          {
            name: "hosted_meal_photo_capture_enrollment_authority_revision_check",
            validated: true,
          },
          {
            name: "hosted_meal_photo_capture_enrollment_credential_shape_check",
            validated: true,
          },
        ]);

        await expectCheckViolation(client, `
          INSERT INTO "hosted_meal_photo_capture_enrollment" (
            "id", "member_id", "installation_id_hash", "authority_revision",
            "upload_token_hash", "idempotency_secret_encrypted", "expires_at",
            "revoked_at", "created_at", "updated_at"
          ) VALUES (
            'malformed-active', 'member-malformed', 'installation-malformed', 1,
            'token-malformed', NULL, '2026-09-01 00:00:00', NULL,
            '2026-08-04 00:00:00', '2026-08-04 00:00:00'
          )
        `);
        await expectCheckViolation(client, `
          INSERT INTO "hosted_meal_photo_capture_enrollment" (
            "id", "member_id", "installation_id_hash", "authority_revision",
            "upload_token_hash", "idempotency_secret_encrypted", "expires_at",
            "revoked_at", "created_at", "updated_at"
          ) VALUES (
            'invalid-revision', 'member-invalid', 'installation-invalid', -1,
            'token-invalid', 'secret-invalid', '2026-09-01 00:00:00', NULL,
            '2026-08-04 00:00:00', '2026-08-04 00:00:00'
          )
        `);

        await expect(client.query(`
          INSERT INTO "hosted_meal_photo_capture_enrollment" (
            "id", "member_id", "installation_id_hash", "authority_revision",
            "upload_token_hash", "idempotency_secret_encrypted", "expires_at",
            "activated_at", "revoked_at", "created_at", "updated_at"
          ) VALUES (
            'valid-prepared', 'member-prepared', 'installation-prepared', 1,
            'token-prepared', 'secret-prepared', '2026-09-01 00:00:00',
            NULL, NULL, '2026-08-04 00:00:00', '2026-08-04 00:00:00'
          )
        `)).resolves.toMatchObject({ rowCount: 1 });
      } finally {
        await client.query("ROLLBACK");
        await client.end();
      }
    });
  },
);

async function expectCheckViolation(client: pg.Client, sql: string): Promise<void> {
  await client.query("SAVEPOINT invalid_shape");
  await expect(client.query(sql)).rejects.toMatchObject({ code: "23514" });
  await client.query("ROLLBACK TO SAVEPOINT invalid_shape");
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
