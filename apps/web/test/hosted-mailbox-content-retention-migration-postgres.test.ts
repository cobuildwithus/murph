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
const recoveryMigrationUrl = new URL(
  "../prisma/migrations/20260728050000_rearm_hosted_mailbox_content_retention/migration.sql",
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
    it("re-arms persisted snapshots after the runner fleet converges", async () => {
      const migrationSql = await readFile(migrationUrl, "utf8");
      const recoveryMigrationSql = await readFile(recoveryMigrationUrl, "utf8");
      const client = new pg.Client({ connectionString: databaseUrl });
      await client.connect();

      try {
        await client.query("BEGIN");
        const timestampResult = await client.query<{
          transactionTimestamp: string;
        }>(`
          SELECT to_char(
            (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::TIMESTAMP(3),
            'YYYY-MM-DD"T"HH24:MI:SS.MS'
          ) AS "transactionTimestamp"
        `);
        const transactionTimestamp =
          timestampResult.rows[0]?.transactionTimestamp ?? null;
        expect(transactionTimestamp).not.toBeNull();

        await client.query(`
          CREATE TEMP TABLE "hosted_mailbox_item" (
            "id" TEXT PRIMARY KEY
          );
          CREATE TEMP TABLE "hosted_workspace" (
            "user_id" TEXT PRIMARY KEY,
            "version" BIGINT NOT NULL,
            "snapshot_ref" TEXT,
            "inbox_media_retention_wake_at" TIMESTAMP(3),
            "inbox_media_retention_signal_attempted_at" TIMESTAMP(3),
            "checkpointed_at" TIMESTAMP(3)
          );

          INSERT INTO "hosted_workspace" (
            "user_id",
            "version",
            "snapshot_ref",
            "inbox_media_retention_wake_at",
            "inbox_media_retention_signal_attempted_at",
            "checkpointed_at"
          )
          VALUES
            (
              'snapshot-existing-wake',
              4,
              'snapshot://existing',
              '2099-01-01T00:00:00.000Z',
              '2026-07-25T18:00:00.000Z',
              '2026-07-25T17:00:00.000Z'
            ),
            (
              'snapshot-missing-wake',
              9,
              'snapshot://missing-wake',
              NULL,
              '2026-07-25T18:00:00.000Z',
              '2026-07-25T17:00:00.000Z'
            ),
            (
              'no-snapshot',
              2,
              NULL,
              '2099-01-01T00:00:00.000Z',
              '2026-07-25T18:00:00.000Z',
              '2026-07-25T17:00:00.000Z'
            );
        `);

        await client.query(migrationSql);

        await client.query(`
          UPDATE "hosted_workspace"
          SET
            "inbox_media_retention_wake_at" =
              CASE
                WHEN "user_id" = 'snapshot-existing-wake'
                  THEN TIMESTAMP '2099-01-01 00:00:00'
                ELSE NULL
              END,
            "inbox_media_retention_signal_attempted_at" =
              '2026-07-28T04:00:00.000Z',
            "checkpointed_at" = '2026-07-28T04:00:00.000Z',
            "version" = "version" + 1
          WHERE "snapshot_ref" IS DISTINCT FROM NULL
        `);

        await client.query(recoveryMigrationSql);

        const staleCheckpoint = await client.query(`
          UPDATE "hosted_workspace"
          SET
            "inbox_media_retention_wake_at" = NULL,
            "checkpointed_at" = '2026-07-26T15:00:00.000Z',
            "version" = "version" + 1
          WHERE "user_id" = 'snapshot-missing-wake'
            AND "version" = 11
        `);
        expect(staleCheckpoint.rowCount).toBe(0);

        const result = await client.query<{
          checkpointedAt: string | null;
          dueNow: boolean;
          userId: string;
          signalAttemptedAt: string | null;
          version: string;
          wakeAt: string | null;
        }>(`
          SELECT
            to_char(
              workspace."checkpointed_at",
              'YYYY-MM-DD"T"HH24:MI:SS.MS'
            ) AS "checkpointedAt",
            workspace."user_id" AS "userId",
            to_char(
              workspace."inbox_media_retention_signal_attempted_at",
              'YYYY-MM-DD"T"HH24:MI:SS.MS'
            ) AS "signalAttemptedAt",
            to_char(
              workspace."inbox_media_retention_wake_at",
              'YYYY-MM-DD"T"HH24:MI:SS.MS'
            ) AS "wakeAt",
            workspace."inbox_media_retention_wake_at"
              <= CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AS "dueNow",
            workspace."version"::TEXT AS "version"
          FROM "hosted_workspace" AS workspace
          ORDER BY workspace."user_id"
        `);

        expect(result.rows).toEqual([
          {
            checkpointedAt: "2026-07-25T17:00:00.000",
            dueNow: false,
            userId: "no-snapshot",
            signalAttemptedAt: "2026-07-25T18:00:00.000",
            version: "2",
            wakeAt: "2099-01-01T00:00:00.000",
          },
          {
            checkpointedAt: "2026-07-28T04:00:00.000",
            dueNow: true,
            userId: "snapshot-existing-wake",
            signalAttemptedAt: null,
            version: "7",
            wakeAt: transactionTimestamp,
          },
          {
            checkpointedAt: "2026-07-28T04:00:00.000",
            dueNow: true,
            userId: "snapshot-missing-wake",
            signalAttemptedAt: null,
            version: "12",
            wakeAt: transactionTimestamp,
          },
        ]);

        const due = await client.query<{ userId: string }>(`
          SELECT "user_id" AS "userId"
          FROM "hosted_workspace"
          WHERE "inbox_media_retention_wake_at"
            <= CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
          ORDER BY "user_id"
        `);
        expect(due.rows).toEqual([
          { userId: "snapshot-existing-wake" },
          { userId: "snapshot-missing-wake" },
        ]);
      } finally {
        await client.query("ROLLBACK");
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
