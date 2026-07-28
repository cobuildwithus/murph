import { readFile } from "node:fs/promises";

import pg from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresMigrationProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

const migrationUrl = new URL(
  "../prisma/migrations/20260728040000_connected_app_approval_presentation_encryption/migration.sql",
  import.meta.url,
);

if (
  runPostgresMigrationProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The connected-app approval migration proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresMigrationProof)(
  "connected-app approval presentation encryption migration",
  () => {
    it("preserves legacy plaintext and requires encrypted connected-app presentation", async () => {
      const migrationSql = await readFile(migrationUrl, "utf8");
      const client = new pg.Client({ connectionString: databaseUrl });
      await client.connect();

      try {
        await client.query("BEGIN");
        await client.query(`
          CREATE TEMP TABLE "hosted_sensitive_action_challenge" (
            "token_hash" TEXT PRIMARY KEY,
            "kind" TEXT NOT NULL,
            "approval_key" TEXT,
            "action_id" TEXT,
            "action_hash" TEXT,
            "presentation_title" TEXT,
            "presentation_body" TEXT,
            "approval_status" TEXT,
            "decided_at" TIMESTAMP(3),
            CONSTRAINT "hosted_sensitive_action_challenge_approval_shape_check"
              CHECK (
                (
                  "kind" = 'assistant.action.approve'
                  AND "approval_key" IS NOT NULL
                  AND "action_id" IS NOT NULL
                  AND "action_hash" IS NOT NULL
                  AND "presentation_title" IS NOT NULL
                  AND "presentation_body" IS NOT NULL
                  AND "approval_status" IS NOT NULL
                )
                OR
                (
                  "kind" <> 'assistant.action.approve'
                  AND "approval_key" IS NULL
                  AND "action_id" IS NULL
                  AND "action_hash" IS NULL
                  AND "presentation_title" IS NULL
                  AND "presentation_body" IS NULL
                  AND "approval_status" IS NULL
                  AND "decided_at" IS NULL
                )
              )
          );

          INSERT INTO "hosted_sensitive_action_challenge" (
            "token_hash",
            "kind",
            "approval_key",
            "action_id",
            "action_hash",
            "presentation_title",
            "presentation_body",
            "approval_status"
          )
          VALUES (
            'legacy-token',
            'assistant.action.approve',
            'legacy-approval',
            'vault-file-send:legacy',
            'legacy-hash',
            'Send a file?',
            'Send report.pdf to this conversation.',
            'pending'
          );
        `);

        await client.query(migrationSql);

        await client.query("SAVEPOINT plaintext_connected_app");
        await expect(client.query(`
          INSERT INTO "hosted_sensitive_action_challenge" (
            "token_hash",
            "kind",
            "approval_key",
            "action_id",
            "action_hash",
            "presentation_title",
            "presentation_body",
            "approval_status"
          )
          VALUES (
            'plaintext-connected-token',
            'assistant.action.approve',
            'plaintext-connected-approval',
            'connected-app:plaintext',
            'plaintext-connected-hash',
            'Create this calendar event?',
            'Event: Annual physical',
            'pending'
          )
        `)).rejects.toMatchObject({ code: "23514" });
        await client.query("ROLLBACK TO SAVEPOINT plaintext_connected_app");

        await client.query(`
          INSERT INTO "hosted_sensitive_action_challenge" (
            "token_hash",
            "kind",
            "approval_key",
            "action_id",
            "action_hash",
            "presentation_title_encrypted",
            "presentation_body_encrypted",
            "approval_status"
          )
          VALUES (
            'encrypted-connected-token',
            'assistant.action.approve',
            'encrypted-connected-approval',
            'connected-app:encrypted',
            'encrypted-connected-hash',
            'encrypted-title',
            'encrypted-body',
            'pending'
          )
        `);

        const rows = await client.query<{
          actionId: string;
          presentationBody: string | null;
          presentationBodyEncrypted: string | null;
        }>(`
          SELECT
            "action_id" AS "actionId",
            "presentation_body" AS "presentationBody",
            "presentation_body_encrypted" AS "presentationBodyEncrypted"
          FROM "hosted_sensitive_action_challenge"
          ORDER BY "action_id"
        `);
        expect(rows.rows).toEqual([
          {
            actionId: "connected-app:encrypted",
            presentationBody: null,
            presentationBodyEncrypted: "encrypted-body",
          },
          {
            actionId: "vault-file-send:legacy",
            presentationBody: "Send report.pdf to this conversation.",
            presentationBodyEncrypted: null,
          },
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
