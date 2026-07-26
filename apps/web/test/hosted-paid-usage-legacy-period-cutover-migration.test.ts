import { readFileSync } from "node:fs";

import pg from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresMigrationProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260725230000_hosted_paid_usage_legacy_period_cutover/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

if (
  runPostgresMigrationProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The paid-usage legacy-period migration proof requires a local DATABASE_URL.",
  );
}

describe("paid-usage legacy-period cutover migration", () => {
  it("is a bounded insert-only cutover that mirrors allowance source ownership", () => {
    expect(migrationSql).toContain(
      "CURRENT_TIMESTAMP AT TIME ZONE 'UTC'",
    );
    expect(migrationSql).toContain(
      'ROW_NUMBER() OVER (\n      PARTITION BY "membership"."member_id"\n'
      + '      ORDER BY "membership"."created_at" ASC',
    );
    expect(migrationSql).toContain(
      '"direct_billing_ref"."current_billing_phase" = \'paid\'',
    );
    expect(migrationSql).toContain(
      'ON CONFLICT ("member_id", "period_start") DO NOTHING',
    );
    expect(migrationSql.match(/25000000::BIGINT/gu)).toHaveLength(2);
    expect(migrationSql.match(/10000000::BIGINT/gu)).toHaveLength(2);
    expect(migrationSql).not.toMatch(/\b(?:UPDATE|DELETE|ALTER)\b/iu);
    expect(migrationSql).not.toContain("date_trunc");
    expect(migrationSql).not.toContain("calendar_start");
    expect(migrationSql).not.toContain("calendar_end");
    expect(migrationSql).not.toMatch(
      /\b(?:5600000|6400000|15200000|16000000)::BIGINT\b/u,
    );
  });
});

describe.skipIf(!runPostgresMigrationProof)(
  "paid-usage legacy-period PostgreSQL cutover",
  () => {
    it("seeds four authoritative paid periods and skips mutable fallbacks", async () => {
      const client = new pg.Client({ connectionString: databaseUrl });
      await client.connect();

      try {
        await client.query("SET TIME ZONE 'America/Los_Angeles'");
        await client.query(`
          CREATE TEMP TABLE "hosted_member" (
            "id" TEXT PRIMARY KEY,
            "billing_status" TEXT NOT NULL,
            "suspended_at" TIMESTAMP(3)
          );
          CREATE TEMP TABLE "hosted_member_billing_ref" (
            "member_id" TEXT PRIMARY KEY,
            "current_billing_plan_code" TEXT,
            "current_billing_phase" TEXT,
            "current_period_start" TIMESTAMP(3),
            "current_period_end" TIMESTAMP(3)
          );
          CREATE TEMP TABLE "hosted_thread_container" (
            "member_id" TEXT PRIMARY KEY
          );
          CREATE TEMP TABLE "hosted_account_group" (
            "id" TEXT PRIMARY KEY,
            "billing_status" TEXT NOT NULL,
            "suspended_at" TIMESTAMP(3)
          );
          CREATE TEMP TABLE "hosted_account_group_membership" (
            "id" TEXT PRIMARY KEY,
            "group_id" TEXT NOT NULL,
            "member_id" TEXT NOT NULL,
            "plan_code" TEXT NOT NULL,
            "status" TEXT NOT NULL,
            "created_at" TIMESTAMP(3) NOT NULL
          );
          CREATE TEMP TABLE "hosted_account_group_billing_ref" (
            "group_id" TEXT PRIMARY KEY,
            "current_billing_plan_code" TEXT,
            "current_billing_phase" TEXT,
            "current_period_start" TIMESTAMP(3),
            "current_period_end" TIMESTAMP(3)
          );
          CREATE TEMP TABLE "hosted_ai_usage_period" (
            "member_id" TEXT NOT NULL,
            "period_start" TIMESTAMP(3) NOT NULL,
            "period_end" TIMESTAMP(3) NOT NULL,
            "billing_plan_code" TEXT NOT NULL,
            "limit_usd_micros" BIGINT NOT NULL,
            "spent_usd_micros" BIGINT NOT NULL,
            "blocked_at" TIMESTAMP(3),
            "last_usage_at" TIMESTAMP(3),
            "created_at" TIMESTAMP(3) NOT NULL,
            "updated_at" TIMESTAMP(3) NOT NULL,
            PRIMARY KEY ("member_id", "period_start")
          );
        `);
        await client.query(`
          INSERT INTO "hosted_member" (
            "id",
            "billing_status",
            "suspended_at"
          )
          VALUES
            ('direct_pulse', 'active', NULL),
            ('direct_edge', 'active', NULL),
            ('direct_invalid_period', 'active', NULL),
            ('family_pulse', 'not_started', NULL),
            ('family_edge', 'not_started', NULL),
            ('family_unpaid', 'not_started', NULL),
            ('family_invalid_oldest', 'not_started', NULL),
            ('direct_wins', 'active', NULL),
            ('existing_period', 'active', NULL),
            ('inactive_direct', 'unpaid', NULL),
            ('thread_direct', 'active', NULL),
            ('suspended_family', 'not_started', CURRENT_TIMESTAMP);

          INSERT INTO "hosted_member_billing_ref" (
            "member_id",
            "current_billing_plan_code",
            "current_billing_phase",
            "current_period_start",
            "current_period_end"
          )
          VALUES
            (
              'direct_pulse',
              'launch_monthly',
              'paid',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' - INTERVAL '7 days',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' + INTERVAL '21 days'
            ),
            (
              'direct_edge',
              'launch_edge_monthly',
              'paid',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' - INTERVAL '6 days',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' + INTERVAL '22 days'
            ),
            (
              'direct_invalid_period',
              'launch_edge_monthly',
              'paid',
              NULL,
              NULL
            ),
            (
              'direct_wins',
              'launch_monthly',
              'paid',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' - INTERVAL '5 days',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' + INTERVAL '23 days'
            ),
            (
              'existing_period',
              'launch_edge_monthly',
              'paid',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' - INTERVAL '4 days',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' + INTERVAL '24 days'
            ),
            (
              'inactive_direct',
              'launch_monthly',
              'paid',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' - INTERVAL '3 days',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' + INTERVAL '25 days'
            ),
            (
              'thread_direct',
              'launch_edge_monthly',
              'paid',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' - INTERVAL '2 days',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' + INTERVAL '26 days'
            );

          INSERT INTO "hosted_thread_container" ("member_id")
          VALUES ('thread_direct');

          INSERT INTO "hosted_account_group" (
            "id",
            "billing_status",
            "suspended_at"
          )
          VALUES
            ('family_pulse_oldest', 'active', NULL),
            ('family_pulse_newer', 'active', NULL),
            ('family_edge_group', 'active', NULL),
            ('family_unpaid_group', 'active', NULL),
            ('family_invalid_oldest_group', 'active', NULL),
            ('family_invalid_newer_group', 'active', NULL),
            ('direct_wins_group', 'active', NULL),
            ('suspended_family_group', 'active', NULL);

          INSERT INTO "hosted_account_group_membership" (
            "id",
            "group_id",
            "member_id",
            "plan_code",
            "status",
            "created_at"
          )
          VALUES
            (
              'membership_family_pulse_oldest',
              'family_pulse_oldest',
              'family_pulse',
              'pulse',
              'active',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' - INTERVAL '20 days'
            ),
            (
              'membership_family_pulse_newer',
              'family_pulse_newer',
              'family_pulse',
              'edge',
              'active',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' - INTERVAL '10 days'
            ),
            (
              'membership_family_edge',
              'family_edge_group',
              'family_edge',
              'edge',
              'active',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' - INTERVAL '9 days'
            ),
            (
              'membership_family_unpaid',
              'family_unpaid_group',
              'family_unpaid',
              'pulse',
              'active',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' - INTERVAL '9 days'
            ),
            (
              'membership_family_invalid_oldest',
              'family_invalid_oldest_group',
              'family_invalid_oldest',
              'invalid',
              'active',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' - INTERVAL '11 days'
            ),
            (
              'membership_family_invalid_newer',
              'family_invalid_newer_group',
              'family_invalid_oldest',
              'pulse',
              'active',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' - INTERVAL '10 days'
            ),
            (
              'membership_direct_wins',
              'direct_wins_group',
              'direct_wins',
              'edge',
              'active',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' - INTERVAL '8 days'
            ),
            (
              'membership_suspended_family',
              'suspended_family_group',
              'suspended_family',
              'pulse',
              'active',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' - INTERVAL '7 days'
            );

          INSERT INTO "hosted_account_group_billing_ref" (
            "group_id",
            "current_billing_plan_code",
            "current_billing_phase",
            "current_period_start",
            "current_period_end"
          )
          VALUES
            (
              'family_pulse_oldest',
              'launch_family_monthly',
              'paid',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' - INTERVAL '8 days',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' + INTERVAL '20 days'
            ),
            (
              'family_pulse_newer',
              'launch_family_monthly',
              'paid',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' - INTERVAL '9 days',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' + INTERVAL '19 days'
            ),
            (
              'family_edge_group',
              'launch_family_monthly',
              'paid',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' - INTERVAL '7 days',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' + INTERVAL '21 days'
            ),
            (
              'family_unpaid_group',
              'launch_family_monthly',
              'unpaid',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' - INTERVAL '7 days',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' + INTERVAL '21 days'
            ),
            (
              'family_invalid_oldest_group',
              'launch_family_monthly',
              'paid',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' - INTERVAL '7 days',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' + INTERVAL '21 days'
            ),
            (
              'family_invalid_newer_group',
              'launch_family_monthly',
              'paid',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' - INTERVAL '7 days',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' + INTERVAL '21 days'
            ),
            (
              'direct_wins_group',
              'launch_family_monthly',
              'paid',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' - INTERVAL '6 days',
              CURRENT_TIMESTAMP AT TIME ZONE 'UTC' + INTERVAL '22 days'
            );

          INSERT INTO "hosted_ai_usage_period" (
            "member_id",
            "period_start",
            "period_end",
            "billing_plan_code",
            "limit_usd_micros",
            "spent_usd_micros",
            "created_at",
            "updated_at"
          )
          SELECT
            'existing_period',
            "current_period_start",
            "current_period_end",
            'launch_edge_monthly',
            123,
            77,
            CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
            CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
          FROM "hosted_member_billing_ref"
          WHERE "member_id" = 'existing_period';
        `);

        const firstRun = await client.query(migrationSql);
        expect(firstRun.rowCount).toBe(5);

        const rows = await client.query<{
          billing_plan_code: string;
          limit_usd_micros: string;
          member_id: string;
          spent_usd_micros: string;
          uses_expected_period: boolean;
        }>(`
          SELECT
            "period"."member_id",
            "period"."billing_plan_code",
            "period"."limit_usd_micros"::TEXT,
            "period"."spent_usd_micros"::TEXT,
            CASE
              WHEN "period"."member_id" IN (
                'direct_pulse',
                'direct_edge',
                'direct_wins',
                'existing_period'
              )
                THEN "period"."period_start" = "direct_ref"."current_period_start"
              WHEN "period"."member_id" = 'family_pulse'
                THEN "period"."period_start" = (
                  SELECT "current_period_start"
                  FROM "hosted_account_group_billing_ref"
                  WHERE "group_id" = 'family_pulse_oldest'
                )
              WHEN "period"."member_id" = 'family_edge'
                THEN "period"."period_start" = (
                  SELECT "current_period_start"
                  FROM "hosted_account_group_billing_ref"
                  WHERE "group_id" = 'family_edge_group'
                )
              ELSE FALSE
            END AS "uses_expected_period"
          FROM "hosted_ai_usage_period" AS "period"
          LEFT JOIN "hosted_member_billing_ref" AS "direct_ref"
            ON "direct_ref"."member_id" = "period"."member_id"
          ORDER BY "period"."member_id"
        `);
        expect(rows.rows).toEqual([
          {
            billing_plan_code: "launch_edge_monthly",
            limit_usd_micros: "25000000",
            member_id: "direct_edge",
            spent_usd_micros: "0",
            uses_expected_period: true,
          },
          {
            billing_plan_code: "launch_monthly",
            limit_usd_micros: "10000000",
            member_id: "direct_pulse",
            spent_usd_micros: "0",
            uses_expected_period: true,
          },
          {
            billing_plan_code: "launch_monthly",
            limit_usd_micros: "10000000",
            member_id: "direct_wins",
            spent_usd_micros: "0",
            uses_expected_period: true,
          },
          {
            billing_plan_code: "launch_edge_monthly",
            limit_usd_micros: "123",
            member_id: "existing_period",
            spent_usd_micros: "77",
            uses_expected_period: true,
          },
          {
            billing_plan_code: "launch_edge_monthly",
            limit_usd_micros: "25000000",
            member_id: "family_edge",
            spent_usd_micros: "0",
            uses_expected_period: true,
          },
          {
            billing_plan_code: "launch_monthly",
            limit_usd_micros: "10000000",
            member_id: "family_pulse",
            spent_usd_micros: "0",
            uses_expected_period: true,
          },
        ]);

        const skippedFallbacks = await client.query<{ count: string }>(`
          SELECT COUNT(*)::TEXT AS "count"
          FROM "hosted_ai_usage_period"
          WHERE "member_id" IN ('direct_invalid_period', 'family_unpaid')
        `);
        expect(skippedFallbacks.rows).toEqual([{ count: "0" }]);

        const followingPeriod = await client.query<{ count: string }>(`
          SELECT COUNT(*)::TEXT AS "count"
          FROM "hosted_ai_usage_period" AS "period"
          INNER JOIN "hosted_member_billing_ref" AS "billing_ref"
            ON "billing_ref"."member_id" = "period"."member_id"
          WHERE
            "period"."member_id" = 'direct_pulse'
            AND "period"."period_start" = "billing_ref"."current_period_end"
        `);
        expect(followingPeriod.rows).toEqual([{ count: "0" }]);

        const secondRun = await client.query(migrationSql);
        expect(secondRun.rowCount).toBe(0);
      } finally {
        await client.end();
      }
    });
  },
);

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "postgres:"
      || parsed.protocol === "postgresql:"
    ) && (
      parsed.hostname === "127.0.0.1"
      || parsed.hostname === "localhost"
      || parsed.hostname === "::1"
    );
  } catch {
    return false;
  }
}
