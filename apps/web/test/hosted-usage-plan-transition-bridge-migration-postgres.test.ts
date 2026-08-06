import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import pg from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresMigrationProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260806180000_fix_hosted_usage_plan_transition_bridge/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

if (
  runPostgresMigrationProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The hosted usage-transition bridge migration proof requires a local DATABASE_URL.",
  );
}

describe("hosted usage-transition bridge corrective migration", () => {
  it("keeps the rolling bridge identity and clears every impossible plan-upgrade shape", () => {
    expect(migrationSql).toContain(
      "CREATE OR REPLACE FUNCTION capture_hosted_member_usage_plan_transition()",
    );
    expect(migrationSql).toContain(
      'WHERE "usage_plan_transition_kind" = \'plan_upgrade\'',
    );
    expect(migrationSql).toContain(") IS NOT TRUE;");
    expect(migrationSql).toContain(
      '"usage_plan_transition_from_code" = \'launch_group_monthly\'',
    );
    expect(migrationSql.match(/\) IS TRUE;/gu)).toHaveLength(2);
    expect(migrationSql).toContain(
      "IF NOT (is_plan_upgrade OR is_trial_conversion) THEN",
    );
    expect(migrationSql).not.toMatch(/DROP\s+(?:TRIGGER|FUNCTION)/iu);
  });
});

describe.skipIf(!runPostgresMigrationProof)(
  "hosted usage-transition bridge corrective migration with PostgreSQL",
  () => {
    it("does not stamp NULL-phase writes and preserves real paid upgrades", async () => {
      const client = new pg.Client({ connectionString: databaseUrl });
      const schemaName = `usage_transition_${randomUUID().replaceAll("-", "_")}`;
      const quotedSchemaName = `"${schemaName}"`;
      await client.connect();

      try {
        await client.query("SET TIME ZONE 'UTC'");
        await client.query(`CREATE SCHEMA ${quotedSchemaName}`);
        await client.query(`SET search_path TO ${quotedSchemaName}, public`);
        await client.query(`
          CREATE TABLE "hosted_member_billing_ref" (
            "member_id" TEXT PRIMARY KEY,
            "current_billing_phase" TEXT,
            "current_billing_plan_code" TEXT,
            "current_checkout_offer" TEXT,
            "last_stripe_event_created_at" TIMESTAMP(3),
            "usage_plan_transition_at" TIMESTAMP(3),
            "usage_plan_transition_from_code" TEXT,
            "usage_plan_transition_kind" TEXT,
            "usage_plan_transition_to_code" TEXT
          );

          CREATE FUNCTION capture_hosted_member_usage_plan_transition()
          RETURNS TRIGGER
          LANGUAGE plpgsql
          AS $$
          BEGIN
            RETURN NEW;
          END;
          $$;

          CREATE TRIGGER "hosted_member_usage_plan_transition_bridge"
          BEFORE UPDATE OF
            "current_billing_phase",
            "current_billing_plan_code",
            "current_checkout_offer",
            "last_stripe_event_created_at"
          ON "hosted_member_billing_ref"
          FOR EACH ROW
          EXECUTE FUNCTION capture_hosted_member_usage_plan_transition();

          INSERT INTO "hosted_member_billing_ref" (
            "member_id",
            "current_billing_phase",
            "current_billing_plan_code",
            "last_stripe_event_created_at",
            "usage_plan_transition_at",
            "usage_plan_transition_from_code",
            "usage_plan_transition_kind",
            "usage_plan_transition_to_code"
          ) VALUES
            (
              'invalid_same_plan',
              NULL,
              'launch_monthly',
              '2026-08-05T16:00:00.000Z',
              '2026-08-05T16:00:00.000Z',
              'launch_monthly',
              'plan_upgrade',
              'launch_monthly'
            ),
            (
              'null_phase',
              NULL,
              'launch_monthly',
              '2026-08-05T16:00:00.000Z',
              NULL,
              NULL,
              NULL,
              NULL
            ),
            (
              'invalid_partial_marker',
              NULL,
              'launch_monthly',
              '2026-08-05T16:00:00.000Z',
              '2026-08-05T16:00:00.000Z',
              NULL,
              'plan_upgrade',
              'launch_edge_monthly'
            );
        `);

        await client.query(migrationSql);

        await expect(client.query<{
          transitionAt: Date | null;
          transitionFrom: string | null;
          transitionKind: string | null;
          transitionTo: string | null;
        }>(`
          SELECT
            "usage_plan_transition_at" AS "transitionAt",
            "usage_plan_transition_from_code" AS "transitionFrom",
            "usage_plan_transition_kind" AS "transitionKind",
            "usage_plan_transition_to_code" AS "transitionTo"
          FROM "hosted_member_billing_ref"
          WHERE "member_id" = 'invalid_same_plan'
        `)).resolves.toMatchObject({
          rows: [{
            transitionAt: null,
            transitionFrom: null,
            transitionKind: null,
            transitionTo: null,
          }],
        });

        await expect(readTransition(client, "invalid_partial_marker")).resolves.toEqual({
          transitionAt: null,
          transitionFrom: null,
          transitionKind: null,
          transitionTo: null,
        });

        await client.query(`
          UPDATE "hosted_member_billing_ref"
          SET "last_stripe_event_created_at" = '2026-08-05T16:05:00.000Z'
          WHERE "member_id" = 'null_phase'
        `);
        await expect(readTransition(client, "null_phase")).resolves.toEqual({
          transitionAt: null,
          transitionFrom: null,
          transitionKind: null,
          transitionTo: null,
        });

        await client.query(`
          UPDATE "hosted_member_billing_ref"
          SET
            "current_billing_phase" = 'paid',
            "last_stripe_event_created_at" = '2026-08-05T16:10:00.000Z'
          WHERE "member_id" = 'null_phase'
        `);
        await expect(readTransition(client, "null_phase")).resolves.toEqual({
          transitionAt: null,
          transitionFrom: null,
          transitionKind: null,
          transitionTo: null,
        });

        await client.query(`
          UPDATE "hosted_member_billing_ref"
          SET
            "current_billing_plan_code" = 'launch_edge_monthly',
            "last_stripe_event_created_at" = '2026-08-05T16:15:00.000Z'
          WHERE "member_id" = 'null_phase'
        `);
        await expect(readTransition(client, "null_phase")).resolves.toEqual({
          transitionAt: new Date("2026-08-05T16:15:00.000Z"),
          transitionFrom: "launch_monthly",
          transitionKind: "plan_upgrade",
          transitionTo: "launch_edge_monthly",
        });
      } finally {
        await client.query("RESET search_path").catch(() => undefined);
        await client.query(`DROP SCHEMA IF EXISTS ${quotedSchemaName} CASCADE`)
          .catch(() => undefined);
        await client.end();
      }
    }, 30_000);
  },
);

async function readTransition(
  client: pg.Client,
  memberId: string,
): Promise<{
  transitionAt: Date | null;
  transitionFrom: string | null;
  transitionKind: string | null;
  transitionTo: string | null;
}> {
  const result = await client.query<{
    transitionAt: Date | null;
    transitionFrom: string | null;
    transitionKind: string | null;
    transitionTo: string | null;
  }>({
    name: "read-hosted-usage-transition-bridge-state",
    text: `
      SELECT
        "usage_plan_transition_at" AS "transitionAt",
        "usage_plan_transition_from_code" AS "transitionFrom",
        "usage_plan_transition_kind" AS "transitionKind",
        "usage_plan_transition_to_code" AS "transitionTo"
      FROM "hosted_member_billing_ref"
      WHERE "member_id" = $1
    `,
    values: [memberId],
  });
  const row = result.rows[0];
  if (!row) {
    throw new Error("Expected hosted usage-transition bridge fixture row.");
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
