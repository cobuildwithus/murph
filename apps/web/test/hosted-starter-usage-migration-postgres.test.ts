import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import pg from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresMigrationProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260807204000_non_expiring_starter_usage/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

if (
  runPostgresMigrationProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The Starter usage migration proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresMigrationProof)(
  "non-expiring Starter usage migration with PostgreSQL",
  () => {
    it("preserves existing credit, migrates each eligible balance, and rolls back malformed history", async () => {
      const client = new pg.Client({ connectionString: databaseUrl });
      const schemaName = `starter_usage_${randomUUID().replaceAll("-", "_")}`;
      const quotedSchemaName = `"${schemaName}"`;
      await client.connect();

      try {
        await client.query("SET TIME ZONE 'UTC'");
        await client.query(`CREATE SCHEMA ${quotedSchemaName}`);
        await client.query(`SET search_path TO ${quotedSchemaName}, public`);
        await createMigrationSchema(client);
        await seedHappyPathFixtures(client);

        await client.query(migrationSql);

        await expect(readMemberProjection(client, "untouched"))
          .resolves.toEqual({
            balance: "4500000",
            billingStatus: "active",
            ledgerVersion: "1",
          });
        await expect(readMemberProjection(client, "partial_with_purchase"))
          .resolves.toEqual({
            balance: "5000000",
            billingStatus: "active",
            ledgerVersion: "3",
          });
        await expect(readMemberProjection(client, "exhausted"))
          .resolves.toEqual({
            balance: "0",
            billingStatus: "active",
            ledgerVersion: "2",
          });

        await expect(readCreditEntries(client, "untouched")).resolves.toEqual([
          {
            amount: "4500000",
            kind: "starter_grant",
            parentGrantEntryId: null,
            sequence: "1",
          },
        ]);
        await expect(readCreditEntries(client, "partial_with_purchase"))
          .resolves.toEqual([
            {
              amount: "2000000",
              kind: "purchase_grant",
              parentGrantEntryId: null,
              sequence: "1",
            },
            {
              amount: "4500000",
              kind: "starter_grant",
              parentGrantEntryId: null,
              sequence: "2",
            },
            {
              amount: "-1500000",
              kind: "usage_debit",
              parentGrantEntryId: expect.stringMatching(/^huce_/u),
              sequence: "3",
            },
          ]);
        await expect(readGrantBalances(client, "partial_with_purchase"))
          .resolves.toEqual(["2000000", "3000000"]);
        await expect(readCreditEntries(client, "exhausted")).resolves.toEqual([
          {
            amount: "4500000",
            kind: "starter_grant",
            parentGrantEntryId: null,
            sequence: "1",
          },
          {
            amount: "-4500000",
            kind: "usage_debit",
            parentGrantEntryId: expect.stringMatching(/^huce_/u),
            sequence: "2",
          },
        ]);

        await expect(readBlockedAt(client, "untouched")).resolves.toBeNull();
        await expect(readBlockedAt(client, "partial_with_purchase"))
          .resolves.toBeNull();
        await expect(readBlockedAt(client, "exhausted"))
          .resolves.toEqual(new Date("2026-08-05T12:00:00.000Z"));

        for (const memberId of [
          "paid",
          "suspended",
          "terminal",
          "already_starter",
        ]) {
          await expect(readMemberProjection(client, memberId)).resolves.toEqual(
            memberId === "already_starter"
              ? {
                  balance: "4500000",
                  billingStatus: "active",
                  ledgerVersion: "1",
                }
              : {
                  balance: "0",
                  billingStatus: memberId === "terminal" ? "canceled" : "active",
                  ledgerVersion: "0",
                },
          );
        }
        await expect(readCreditEntries(client, "paid")).resolves.toEqual([]);
        await expect(readCreditEntries(client, "suspended")).resolves.toEqual([]);
        await expect(readCreditEntries(client, "terminal")).resolves.toEqual([]);
        await expect(readCreditEntries(client, "already_starter"))
          .resolves.toHaveLength(1);

        await seedAtomicRollbackFixtures(client);
        await expect(client.query(migrationSql)).rejects.toThrow(
          /legacy trial usage period is malformed/iu,
        );
        await client.query("ROLLBACK");
        await expect(readMemberProjection(client, "atomic_valid"))
          .resolves.toEqual({
            balance: "0",
            billingStatus: "active",
            ledgerVersion: "0",
          });
        await expect(readMemberProjection(client, "malformed"))
          .resolves.toEqual({
            balance: "0",
            billingStatus: "active",
            ledgerVersion: "0",
          });
        await expect(readCreditEntries(client, "atomic_valid"))
          .resolves.toEqual([]);
        await expect(readCreditEntries(client, "malformed"))
          .resolves.toEqual([]);
      } finally {
        await client.query("RESET search_path").catch(() => undefined);
        await client.query(`DROP SCHEMA IF EXISTS ${quotedSchemaName} CASCADE`)
          .catch(() => undefined);
        await client.end();
      }
    }, 30_000);
  },
);

async function createMigrationSchema(client: pg.Client): Promise<void> {
  await client.query(`
    CREATE TYPE "HostedUsageCreditEntryKind" AS ENUM (
      'starter_grant',
      'purchase_grant',
      'referral_grant',
      'usage_debit',
      'refund_adjustment',
      'dispute_adjustment'
    );

    CREATE TABLE "hosted_member" (
      "id" TEXT PRIMARY KEY,
      "billing_status" TEXT NOT NULL,
      "suspended_at" TIMESTAMP(3),
      "usage_credit_balance_usd_micros" BIGINT NOT NULL DEFAULT 0,
      "usage_credit_ledger_version" BIGINT NOT NULL DEFAULT 0,
      "created_at" TIMESTAMP(3) NOT NULL,
      "updated_at" TIMESTAMP(3) NOT NULL
    );

    CREATE TABLE "hosted_member_billing_ref" (
      "member_id" TEXT PRIMARY KEY,
      "current_billing_phase" TEXT,
      "current_checkout_offer" TEXT,
      "current_trial_started_at" TIMESTAMP(3),
      "pulse_trial_redeemed_at" TIMESTAMP(3)
    );

    CREATE TABLE "hosted_ai_usage_period" (
      "member_id" TEXT NOT NULL,
      "period_start" TIMESTAMP(3) NOT NULL,
      "period_end" TIMESTAMP(3) NOT NULL,
      "limit_usd_micros" BIGINT NOT NULL,
      "spent_usd_micros" BIGINT NOT NULL,
      "blocked_at" TIMESTAMP(3),
      "updated_at" TIMESTAMP(3) NOT NULL,
      PRIMARY KEY ("member_id", "period_start")
    );

    CREATE TABLE "hosted_usage_credit_entry" (
      "id" TEXT PRIMARY KEY,
      "beneficiary_member_id" TEXT NOT NULL,
      "beneficiary_sequence" BIGINT NOT NULL,
      "kind" "HostedUsageCreditEntryKind" NOT NULL,
      "amount_usd_micros" BIGINT NOT NULL,
      "effective_at" TIMESTAMP(3) NOT NULL,
      "semantic_source_key" TEXT NOT NULL UNIQUE,
      "purchase_id" TEXT,
      "referral_id" TEXT,
      "parent_grant_entry_id" TEXT,
      "source_usage_id" TEXT,
      "source_reference_lookup_key" TEXT,
      "created_at" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "hosted_usage_credit_entry_amount_direction_valid"
        CHECK (
          ("kind" IN ('purchase_grant', 'referral_grant') AND "amount_usd_micros" > 0)
          OR ("kind" = 'usage_debit' AND "amount_usd_micros" < 0)
          OR ("kind" IN ('refund_adjustment', 'dispute_adjustment') AND "amount_usd_micros" <> 0)
        ),
      CONSTRAINT "hosted_usage_credit_entry_source_shape_valid"
        CHECK ("kind" <> 'starter_grant')
    );

    CREATE TABLE "hosted_usage_credit_grant" (
      "entry_id" TEXT PRIMARY KEY,
      "remaining_usd_micros" BIGINT NOT NULL,
      "created_at" TIMESTAMP(3) NOT NULL,
      "updated_at" TIMESTAMP(3) NOT NULL
    );
  `);
}

async function seedHappyPathFixtures(client: pg.Client): Promise<void> {
  await client.query(`
    INSERT INTO "hosted_member" (
      "id", "billing_status", "suspended_at",
      "usage_credit_balance_usd_micros", "usage_credit_ledger_version",
      "created_at", "updated_at"
    ) VALUES
      ('untouched', 'active', NULL, 0, 0, '2026-08-01', '2026-08-01'),
      ('partial_with_purchase', 'active', NULL, 2000000, 1, '2026-08-01', '2026-08-01'),
      ('exhausted', 'paused', NULL, 0, 0, '2026-08-01', '2026-08-01'),
      ('paid', 'active', NULL, 0, 0, '2026-08-01', '2026-08-01'),
      ('suspended', 'active', '2026-08-06', 0, 0, '2026-08-01', '2026-08-01'),
      ('terminal', 'canceled', NULL, 0, 0, '2026-08-01', '2026-08-01'),
      ('already_starter', 'active', NULL, 4500000, 1, '2026-08-01', '2026-08-01');

    INSERT INTO "hosted_member_billing_ref" (
      "member_id", "current_billing_phase", "current_checkout_offer",
      "current_trial_started_at", "pulse_trial_redeemed_at"
    ) VALUES
      ('untouched', 'trial', 'pulse_trial_7d', '2026-08-01', '2026-08-01'),
      ('partial_with_purchase', 'trial', 'pulse_trial_7d', '2026-08-01', '2026-08-01'),
      ('exhausted', 'trial', 'pulse_trial_7d', '2026-08-01', '2026-08-01'),
      ('paid', 'paid', 'standard', '2026-08-01', '2026-08-01'),
      ('suspended', 'trial', 'pulse_trial_7d', '2026-08-01', '2026-08-01'),
      ('terminal', 'trial', 'pulse_trial_7d', '2026-08-01', '2026-08-01'),
      ('already_starter', 'trial', 'pulse_trial_7d', '2026-08-01', '2026-08-01');

    INSERT INTO "hosted_ai_usage_period" (
      "member_id", "period_start", "period_end",
      "limit_usd_micros", "spent_usd_micros", "blocked_at", "updated_at"
    ) VALUES
      ('untouched', '2026-08-01', '2026-08-08', 4500000, 0, '2026-08-05T12:00:00Z', '2026-08-05'),
      ('partial_with_purchase', '2026-08-01', '2026-08-08', 4500000, 1500000, '2026-08-05T12:00:00Z', '2026-08-05'),
      ('exhausted', '2026-08-01', '2026-08-08', 4500000, 4500000, '2026-08-05T12:00:00Z', '2026-08-05');

    INSERT INTO "hosted_usage_credit_entry" (
      "id", "beneficiary_member_id", "beneficiary_sequence", "kind",
      "amount_usd_micros", "effective_at", "semantic_source_key",
      "purchase_id", "referral_id", "parent_grant_entry_id",
      "source_usage_id", "source_reference_lookup_key", "created_at"
    ) VALUES
      (
        'purchase_partial', 'partial_with_purchase', 1, 'purchase_grant',
        2000000, '2026-07-20', 'purchase:partial', 'purchase_1', NULL, NULL,
        NULL, 'purchase-source', '2026-07-20'
      ),
      (
        'starter_existing', 'already_starter', 1, 'purchase_grant',
        4500000, '2026-08-01',
        'hosted-starter-usage:already_starter:starter-usage-2026-08-07-v1',
        'legacy_placeholder', NULL, NULL, NULL, 'legacy-source', '2026-08-01'
      );

    INSERT INTO "hosted_usage_credit_grant" (
      "entry_id", "remaining_usd_micros", "created_at", "updated_at"
    ) VALUES
      ('purchase_partial', 2000000, '2026-07-20', '2026-07-20'),
      ('starter_existing', 4500000, '2026-08-01', '2026-08-01');
  `);
}

async function seedAtomicRollbackFixtures(client: pg.Client): Promise<void> {
  await client.query(`
    INSERT INTO "hosted_member" (
      "id", "billing_status", "suspended_at",
      "usage_credit_balance_usd_micros", "usage_credit_ledger_version",
      "created_at", "updated_at"
    ) VALUES
      ('atomic_valid', 'active', NULL, 0, 0, '2026-08-01', '2026-08-01'),
      ('malformed', 'active', NULL, 0, 0, '2026-08-01', '2026-08-01');

    INSERT INTO "hosted_member_billing_ref" (
      "member_id", "current_billing_phase", "current_checkout_offer",
      "current_trial_started_at", "pulse_trial_redeemed_at"
    ) VALUES
      ('atomic_valid', 'trial', 'pulse_trial_7d', '2026-08-01', '2026-08-01'),
      ('malformed', 'trial', 'pulse_trial_7d', '2026-08-01', '2026-08-01');

    INSERT INTO "hosted_ai_usage_period" (
      "member_id", "period_start", "period_end",
      "limit_usd_micros", "spent_usd_micros", "blocked_at", "updated_at"
    ) VALUES
      ('atomic_valid', '2026-08-01', '2026-08-08', 4500000, 0, NULL, '2026-08-05'),
      ('malformed', '2026-08-01', '2026-08-08', -1, 0, NULL, '2026-08-05');
  `);
}

async function readMemberProjection(
  client: pg.Client,
  memberId: string,
): Promise<{
  balance: string;
  billingStatus: string;
  ledgerVersion: string;
}> {
  const result = await client.query<{
    balance: string;
    billingStatus: string;
    ledgerVersion: string;
  }>({
    text: `
      SELECT
        "usage_credit_balance_usd_micros"::TEXT AS "balance",
        "billing_status" AS "billingStatus",
        "usage_credit_ledger_version"::TEXT AS "ledgerVersion"
      FROM "hosted_member"
      WHERE "id" = $1
    `,
    values: [memberId],
  });
  const row = result.rows[0];
  if (!row) {
    throw new Error("Expected a hosted member migration fixture.");
  }
  return row;
}

async function readCreditEntries(
  client: pg.Client,
  memberId: string,
): Promise<Array<{
  amount: string;
  kind: string;
  parentGrantEntryId: string | null;
  sequence: string;
}>> {
  const result = await client.query<{
    amount: string;
    kind: string;
    parentGrantEntryId: string | null;
    sequence: string;
  }>({
    text: `
      SELECT
        "amount_usd_micros"::TEXT AS "amount",
        "kind"::TEXT AS "kind",
        "parent_grant_entry_id" AS "parentGrantEntryId",
        "beneficiary_sequence"::TEXT AS "sequence"
      FROM "hosted_usage_credit_entry"
      WHERE "beneficiary_member_id" = $1
      ORDER BY "beneficiary_sequence" ASC
    `,
    values: [memberId],
  });
  return result.rows;
}

async function readGrantBalances(
  client: pg.Client,
  memberId: string,
): Promise<string[]> {
  const result = await client.query<{ remaining: string }>({
    text: `
      SELECT usage_grant."remaining_usd_micros"::TEXT AS "remaining"
      FROM "hosted_usage_credit_grant" AS usage_grant
      INNER JOIN "hosted_usage_credit_entry" AS entry
        ON entry."id" = usage_grant."entry_id"
      WHERE entry."beneficiary_member_id" = $1
      ORDER BY entry."beneficiary_sequence" ASC
    `,
    values: [memberId],
  });
  return result.rows.map((row) => row.remaining);
}

async function readBlockedAt(
  client: pg.Client,
  memberId: string,
): Promise<Date | null> {
  const result = await client.query<{ blockedAt: Date | null }>({
    text: `
      SELECT "blocked_at" AS "blockedAt"
      FROM "hosted_ai_usage_period"
      WHERE "member_id" = $1
    `,
    values: [memberId],
  });
  return result.rows[0]?.blockedAt ?? null;
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
