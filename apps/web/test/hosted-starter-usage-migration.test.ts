import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  fileURLToPath(new URL(
    "../prisma/migrations/20260807204000_non_expiring_starter_usage/migration.sql",
    import.meta.url,
  )),
  "utf8",
);

describe("non-expiring starter usage migration", () => {
  it("records one canonical full grant plus deterministic historical consumption", () => {
    expect(migrationSql).toContain(
      '4500000::BIGINT AS "grant_usd_micros"',
    );
    expect(migrationSql).toContain(
      '\'starter_grant\'::"HostedUsageCreditEntryKind"',
    );
    expect(migrationSql).toContain(
      '\'usage_debit\'::"HostedUsageCreditEntryKind"',
    );
    expect(migrationSql).toContain(
      '-migration."consumed_usd_micros"',
    );
    expect(migrationSql).toContain(
      'WHERE migration."consumed_usd_micros" > 0',
    );
  });

  it("keeps exhausted accounts in immutable grant history and projects only remaining capacity", () => {
    const migrationSelection = migrationSql.slice(
      migrationSql.indexOf('CREATE TEMP TABLE "hosted_starter_usage_migration"'),
      migrationSql.indexOf('INSERT INTO "hosted_usage_credit_entry"'),
    );

    expect(migrationSelection).not.toContain(
      '"remaining_usd_micros" > 0',
    );
    expect(migrationSql).toContain(
      'migration."remaining_usd_micros",\n  CURRENT_TIMESTAMP',
    );
    expect(migrationSql).toContain(
      'migration."existing_balance_usd_micros"\n      + migration."remaining_usd_micros"',
    );
    expect(migrationSql).toContain(
      'WHEN migration."consumed_usd_micros" > 0\n    THEN migration."debit_beneficiary_sequence"',
    );
  });

  it("does not reactivate paid, suspended, or explicitly terminal accounts", () => {
    expect(migrationSql).toContain(
      'member."suspended_at" IS NULL',
    );
    expect(migrationSql).toContain(
      'member."billing_status" IN (\'active\', \'paused\', \'incomplete\')',
    );
    expect(migrationSql).toContain(
      'billing_ref."current_billing_phase" IS DISTINCT FROM \'paid\'',
    );
  });
});
