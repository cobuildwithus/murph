import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const starterConstraintMigrationId =
  "20260807204000_non_expiring_starter_usage";
const referralConstraintMigrationId =
  "20260728030000_hosted_usage_referral_credit_entry_constraints";
const referralProjectionContractMigrationId =
  "20260728031000_resynchronize_hosted_usage_credit_purchase_grants";
const migrationsDir = fileURLToPath(
  new URL("../prisma/migrations/", import.meta.url),
);
const schema = readFileSync(
  new URL("../prisma/schema.prisma", import.meta.url),
  "utf8",
);
const referralConstraintMigration = readFileSync(
  new URL(
    `../prisma/migrations/${referralConstraintMigrationId}/migration.sql`,
    import.meta.url,
  ),
  "utf8",
);
const referralProjectionContractMigration = readFileSync(
  new URL(
    `../prisma/contract-migrations/${referralProjectionContractMigrationId}/migration.sql`,
    import.meta.url,
  ),
  "utf8",
);

type ConstraintAddition = {
  migrationId: string;
  sql: string;
};

describe("hosted usage-credit entry constraint migrations", () => {
  it("keeps every schema enum kind in the latest amount and source checks", () => {
    const entryKinds = readPrismaEnumValues(
      schema,
      "HostedUsageCreditEntryKind",
    );
    const amountConstraint = readLatestConstraintAddition(
      "hosted_usage_credit_entry_amount_direction_valid",
    );
    const sourceConstraint = readLatestConstraintAddition(
      "hosted_usage_credit_entry_source_shape_valid",
    );

    expect(entryKinds).toEqual([
      "starter_grant",
      "purchase_grant",
      "referral_grant",
      "usage_debit",
      "refund_adjustment",
      "dispute_adjustment",
    ]);
    expect(amountConstraint.migrationId).toBe(starterConstraintMigrationId);
    expect(sourceConstraint.migrationId).toBe(starterConstraintMigrationId);

    for (const entryKind of entryKinds) {
      expect(amountConstraint.sql).toContain(`'${entryKind}'`);
      expect(sourceConstraint.sql).toContain(`'${entryKind}'`);
    }
  });

  it("preserves every ledger branch and requires one exact grant authority", () => {
    const amountConstraint = normalizeSql(
      readLatestConstraintAddition(
        "hosted_usage_credit_entry_amount_direction_valid",
      ).sql,
    );
    const sourceConstraint = normalizeSql(
      readLatestConstraintAddition(
        "hosted_usage_credit_entry_source_shape_valid",
      ).sql,
    );

    expect(amountConstraint).toBe(
      normalizeSql(`
        ADD CONSTRAINT "hosted_usage_credit_entry_amount_direction_valid"
          CHECK (
            ("kind" IN ('starter_grant', 'purchase_grant', 'referral_grant') AND "amount_usd_micros" > 0)
            OR ("kind" = 'usage_debit' AND "amount_usd_micros" < 0)
            OR ("kind" IN ('refund_adjustment', 'dispute_adjustment') AND "amount_usd_micros" <> 0)
          ) NOT VALID,
      `),
    );
    expect(sourceConstraint).toBe(
      normalizeSql(`
        ADD CONSTRAINT "hosted_usage_credit_entry_source_shape_valid"
          CHECK (
            (
              "kind" = 'starter_grant'
              AND "purchase_id" IS NULL
              AND "referral_id" IS NULL
              AND "parent_grant_entry_id" IS NULL
              AND "source_usage_id" IS NULL
              AND "source_reference_lookup_key" IS NOT NULL
            )
            OR
            (
              "kind" = 'purchase_grant'
              AND "purchase_id" IS NOT NULL
              AND "referral_id" IS NULL
              AND "parent_grant_entry_id" IS NULL
              AND "source_usage_id" IS NULL
            )
            OR
            (
              "kind" = 'referral_grant'
              AND "purchase_id" IS NULL
              AND "referral_id" IS NOT NULL
              AND "parent_grant_entry_id" IS NULL
              AND "source_usage_id" IS NULL
            )
            OR
            (
              "kind" = 'usage_debit'
              AND NOT (
                "purchase_id" IS NOT NULL
                AND "referral_id" IS NOT NULL
              )
              AND "parent_grant_entry_id" IS NOT NULL
              AND "source_usage_id" IS NOT NULL
            )
            OR
            (
              "kind" IN ('refund_adjustment', 'dispute_adjustment')
              AND "purchase_id" IS NOT NULL
              AND "referral_id" IS NULL
              AND "parent_grant_entry_id" IS NOT NULL
              AND "source_usage_id" IS NULL
              AND "source_reference_lookup_key" IS NOT NULL
            )
          ) NOT VALID;
      `),
    );
  });

  it("commits the bounded metadata swap before validation and leaves resync DML-only", () => {
    const firstCommit = referralConstraintMigration.indexOf("COMMIT;");
    const firstValidation = referralConstraintMigration.indexOf(
      'VALIDATE CONSTRAINT "hosted_usage_credit_entry_amount_direction_valid"',
    );

    expect(referralConstraintMigration.match(/^BEGIN;$/gmu)).toHaveLength(2);
    expect(
      referralConstraintMigration.match(/^SET LOCAL lock_timeout = '5s';$/gmu),
    ).toHaveLength(2);
    expect(referralConstraintMigration.match(/^COMMIT;$/gmu)).toHaveLength(2);
    expect(referralConstraintMigration).toContain(
      'DROP CONSTRAINT IF EXISTS "hosted_usage_credit_entry_amount_direction_valid"',
    );
    expect(referralConstraintMigration).toContain(
      'DROP CONSTRAINT IF EXISTS "hosted_usage_credit_entry_source_shape_valid"',
    );
    expect(referralConstraintMigration.match(/\) NOT VALID/gmu)).toHaveLength(2);
    expect(firstCommit).toBeGreaterThan(0);
    expect(firstValidation).toBeGreaterThan(firstCommit);

    expect(referralProjectionContractMigration).toContain(
      'ON CONFLICT ("entry_id") DO UPDATE',
    );
    expect(referralProjectionContractMigration).toContain(
      '"remaining_usd_micros" = EXCLUDED."remaining_usd_micros"',
    );
    expect(referralProjectionContractMigration).toContain(
      'SELECT COUNT(*) AS "lockedBeneficiaryCount"',
    );
    expect(referralProjectionContractMigration).toContain(
      'ORDER BY member."id"\n  FOR UPDATE',
    );
    expect(referralProjectionContractMigration).toContain(
      'IS DISTINCT FROM purchase."remaining_credit_usd_micros"',
    );
    expect(referralProjectionContractMigration.indexOf(
      'ORDER BY member."id"\n  FOR UPDATE',
    )).toBeLessThan(referralProjectionContractMigration.indexOf(
      'INSERT INTO "hosted_usage_credit_grant"',
    ));
    expect(referralProjectionContractMigration).not.toMatch(
      /ALTER\s+TABLE|ADD\s+CONSTRAINT|DROP\s+CONSTRAINT/iu,
    );
  });
});

function readLatestConstraintAddition(
  constraintName: string,
): ConstraintAddition {
  let latest: ConstraintAddition | undefined;
  const marker = new RegExp(
    `ADD\\s+CONSTRAINT\\s+"${constraintName}"\\s+CHECK\\s*\\([\\s\\S]*?\\)\\s*(?:NOT\\s+VALID\\s*)?(?:,|;)`,
    "gu",
  );
  const migrationIds = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  for (const migrationId of migrationIds) {
    const sql = readFileSync(
      path.join(migrationsDir, migrationId, "migration.sql"),
      "utf8",
    );
    const matches = [...sql.matchAll(marker)];
    const match = matches.at(-1)?.[0];
    if (match !== undefined) {
      latest = { migrationId, sql: match };
    }
  }

  if (latest === undefined) {
    throw new Error(`Missing normal migration for ${constraintName}.`);
  }
  return latest;
}

function readPrismaEnumValues(source: string, enumName: string): string[] {
  const match = source.match(
    new RegExp(`enum\\s+${enumName}\\s*\\{([\\s\\S]*?)\\}`, "u"),
  );
  if (match?.[1] === undefined) {
    throw new Error(`Missing Prisma enum ${enumName}.`);
  }

  return match[1]
    .split(/\r?\n/u)
    .map((line) => line.trim().split(/\s+/u)[0])
    .filter(
      (value): value is string =>
        value !== undefined && value.length > 0 && !value.startsWith("//"),
    );
}

function normalizeSql(value: string): string {
  return value
    .replace(/\s+/gu, " ")
    .replace(/\(\s+/gu, "(")
    .replace(/\s+\)/gu, ")")
    .trim();
}
