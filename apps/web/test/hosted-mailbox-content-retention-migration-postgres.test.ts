import { readFile } from "node:fs/promises";

import pg from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresMigrationProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

const migrationUrl = new URL(
  "../prisma/migrations/20260725190000_hosted_mailbox_content_retention/migration.sql",
  import.meta.url,
);

if (
  runPostgresMigrationProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The hosted mailbox content-retention migration proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresMigrationProof)(
  "hosted mailbox content-retention migration",
  () => {
    it("re-arms every persisted snapshot and leaves snapshotless rows untouched", async () => {
      const migrationSql = await readFile(migrationUrl, "utf8");
      const client = new pg.Client({ connectionString: databaseUrl });
      await client.connect();

      try {
        await client.query(`
          CREATE TEMP TABLE "hosted_mailbox_item" (
            "id" TEXT PRIMARY KEY
          );
          CREATE TEMP TABLE "hosted_workspace" (
            "user_id" TEXT PRIMARY KEY,
            "snapshot_ref" TEXT,
            "inbox_media_retention_wake_at" TIMESTAMP(3),
            "inbox_media_retention_signal_attempted_at" TIMESTAMP(3)
          );

          INSERT INTO "hosted_workspace" (
            "user_id",
            "snapshot_ref",
            "inbox_media_retention_wake_at",
            "inbox_media_retention_signal_attempted_at"
          )
          VALUES
            (
              'snapshot-existing-wake',
              'snapshot://existing',
              '2099-01-01T00:00:00.000Z',
              '2026-07-25T18:00:00.000Z'
            ),
            (
              'snapshot-missing-wake',
              'snapshot://missing-wake',
              NULL,
              '2026-07-25T18:00:00.000Z'
            ),
            (
              'no-snapshot',
              NULL,
              '2099-01-01T00:00:00.000Z',
              '2026-07-25T18:00:00.000Z'
            );
        `);

        await client.query(migrationSql);

        const result = await client.query<{
          attemptedAtCleared: boolean;
          userId: string;
          wakeIsOriginal: boolean;
          wakePresent: boolean;
        }>(`
          SELECT
            workspace."user_id" AS "userId",
            workspace."inbox_media_retention_signal_attempted_at" IS NULL
              AS "attemptedAtCleared",
            workspace."inbox_media_retention_wake_at" IS NOT NULL
              AS "wakePresent",
            workspace."inbox_media_retention_wake_at"
              = TIMESTAMP '2099-01-01T00:00:00.000Z'
              AS "wakeIsOriginal"
          FROM "hosted_workspace" AS workspace
          ORDER BY workspace."user_id"
        `);

        expect(result.rows).toEqual([
          {
            attemptedAtCleared: false,
            userId: "no-snapshot",
            wakeIsOriginal: true,
            wakePresent: true,
          },
          {
            attemptedAtCleared: true,
            userId: "snapshot-existing-wake",
            wakeIsOriginal: false,
            wakePresent: true,
          },
          {
            attemptedAtCleared: true,
            userId: "snapshot-missing-wake",
            wakeIsOriginal: false,
            wakePresent: true,
          },
        ]);
      } finally {
        await client.end();
      }
    });
  },
);

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol.startsWith("postgres")
      && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}
