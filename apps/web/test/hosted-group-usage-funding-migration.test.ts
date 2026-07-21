import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260720230000_hosted_group_usage_funding/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const contractMigrationSql = readFileSync(
  new URL(
    "../prisma/contract-migrations/20260720233000_hosted_group_usage_funding_invariants/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("hosted group usage funding migration", () => {
  it("expands payer storage before enforcing detached-payer invariants", () => {
    expect(migrationSql).toContain('"payer_member_id" DROP NOT NULL');
    expect(migrationSql).not.toMatch(/DROP CONSTRAINT|ADD CONSTRAINT/iu);
    expect(contractMigrationSql).toContain(
      '"hosted_usage_credit_purchase_active_payer_required"',
    );
    expect(contractMigrationSql).toContain(
      '"hosted_usage_credit_purchase_deleted_payer_ciphertext_cleared"',
    );
    expect(contractMigrationSql).toContain('"stripe_customer_id_encrypted" IS NULL');
    expect(contractMigrationSql).toContain('"stripe_charge_id_encrypted" IS NULL');
    expect(contractMigrationSql.match(/NOT VALID/gu)).toHaveLength(2);
    expect(contractMigrationSql.match(/VALIDATE CONSTRAINT/gu)).toHaveLength(2);
  });

  it("does not add a second public funding capability", () => {
    expect(`${migrationSql}\n${contractMigrationSql}`).not.toMatch(
      /funding_code|funding_token/iu,
    );
  });
});
