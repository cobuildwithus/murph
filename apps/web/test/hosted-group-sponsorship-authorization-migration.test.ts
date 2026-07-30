import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260730120000_hosted_capped_group_sponsorship/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const schema = readFileSync(
  new URL("../prisma/schema.prisma", import.meta.url),
  "utf8",
);

describe("capped group sponsorship database contract", () => {
  it("enforces one live sponsor per beneficiary and only the three caps", () => {
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX "hosted_group_sponsorship_authorization_live_beneficiary_key"',
    );
    expect(migrationSql).toContain(
      "WHERE \"status\" IN ('pending_activation', 'active', 'paused', 'recovery_required')",
    );
    expect(migrationSql).toContain(
      '"monthly_cap_minor" IN (500, 1000, 2000)',
    );
    expect(migrationSql).toContain(
      '"pending_monthly_cap_minor" IN (500, 1000, 2000)',
    );
  });


  it("associates deterministic exact-$5 purchases without a second balance", () => {
    expect(migrationSql).toContain(
      '"hosted_usage_credit_purchase_sponsorship_shape_valid"',
    );
    expect(migrationSql).toContain('"cash_amount_minor" = 500');
    expect(migrationSql).toContain('"grant_usd_micros" = 5000000');
    expect(migrationSql).toContain(
      '"hosted_usage_credit_purchase_sponsorship_period_ordinal_key"',
    );
    const authorizationTable = migrationSql.match(
      /CREATE TABLE "hosted_group_sponsorship_authorization"[\s\S]*?\n\);/u,
    )?.[0];
    expect(authorizationTable).toBeDefined();
    expect(authorizationTable).not.toMatch(/charged|balance|credit/iu);
    expect(schema).toContain("purchases                HostedUsageCreditPurchase[]");
    expect(schema).not.toMatch(
      /model HostedGroupSponsorshipAuthorization[\s\S]*?(?:charged|balance)Minor/iu,
    );
  });

  it("indexes only the existing bounded refill and recovery sweep", () => {
    const replacementIndexPosition = migrationSql.indexOf(
      'CREATE UNIQUE INDEX "hosted_usage_credit_purchase_active_payer_v2_key"',
    );
    const oldIndexDropPosition = migrationSql.indexOf(
      'DROP INDEX "hosted_usage_credit_purchase_active_payer_key"',
    );
    expect(replacementIndexPosition).toBeGreaterThan(-1);
    expect(oldIndexDropPosition).toBeGreaterThan(replacementIndexPosition);
    expect(migrationSql).toContain(
      'CREATE INDEX "hosted_usage_credit_purchase_sponsorship_refill_dispatch_idx"',
    );
    expect(migrationSql).toContain(
      '"last_reconciled_at" ASC NULLS FIRST',
    );
    expect(migrationSql).toContain(
      'WHERE "group_sponsorship_charge_ordinal" > 0',
    );
    expect(migrationSql).toContain(
      'AND "status" IN (\'created\', \'payment_pending\', \'payment_failed\')',
    );
    expect(migrationSql).not.toMatch(
      /CREATE TABLE[^;]*(?:refill|dispatch|work|queue)/iu,
    );
  });
});
