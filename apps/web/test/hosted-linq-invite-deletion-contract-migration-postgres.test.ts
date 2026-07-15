import { readFile } from "node:fs/promises";

import pg from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresMigrationProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

const predeployMigrationUrl = new URL(
  "../prisma/migrations/20260715120000_delete_orphaned_linq_invite_deliveries/migration.sql",
  import.meta.url,
);
const contractMigrationUrl = new URL(
  "../prisma/contract-migrations/20260715150000_delete_orphaned_linq_invite_deliveries_after_drain/migration.sql",
  import.meta.url,
);

describe.skipIf(!runPostgresMigrationProof)(
  "Linq invite deletion post-drain contract migration",
  () => {
    it("removes rows orphaned after predeploy while preserving scoped controls", async () => {
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is required for the PostgreSQL migration proof.");
      }

      const [predeploySql, contractSql] = await Promise.all([
        readFile(predeployMigrationUrl, "utf8"),
        readFile(contractMigrationUrl, "utf8"),
      ]);
      expect(contractSql).toBe(predeploySql);

      const client = new pg.Client({ connectionString: databaseUrl });
      await client.connect();

      try {
        await client.query(`
          CREATE TEMP TABLE "hosted_member" (
            "id" TEXT PRIMARY KEY
          );
          CREATE TEMP TABLE "hosted_linq_delivery" (
            "id" TEXT PRIMARY KEY,
            "source_ref" TEXT NOT NULL,
            "template" TEXT NOT NULL
          );
        `);
        await client.query(`
          INSERT INTO "hosted_member" ("id")
          VALUES ('member_live'), ('member_deleted_after_predeploy');

          INSERT INTO "hosted_linq_delivery" ("id", "source_ref", "template")
          VALUES
            ('live', 'linq-invite-signup:member_live', 'invite_signup'),
            (
              'deleted-after-predeploy',
              'linq-invite-signup:member_deleted_after_predeploy',
              'invite_signup_fallback'
            ),
            ('unrelated-template', 'linq-invite-signup:member_missing', 'reply'),
            ('opaque-source', 'provider-delivery:member_missing', 'invite_signup');
        `);

        const predeployResult = await client.query(predeploySql);
        expect(predeployResult.rowCount).toBe(0);

        await client.query(
          `DELETE FROM "hosted_member" WHERE "id" = 'member_deleted_after_predeploy'`,
        );

        const contractResult = await client.query(contractSql);
        expect(contractResult.rowCount).toBe(1);

        const remaining = await client.query<{ id: string }>(`
          SELECT "id"
          FROM "hosted_linq_delivery"
          ORDER BY "id"
        `);
        expect(remaining.rows.map(({ id }) => id)).toEqual([
          "live",
          "opaque-source",
          "unrelated-template",
        ]);

        const idempotentResult = await client.query(contractSql);
        expect(idempotentResult.rowCount).toBe(0);
      } finally {
        await client.end();
      }
    });
  },
);
