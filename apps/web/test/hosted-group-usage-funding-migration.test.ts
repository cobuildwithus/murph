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
const detachedDirectProofMigrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260727040000_relax_hosted_usage_credit_detached_direct_proof/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const detachedAutomaticRefillFailureMigrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260810050000_relax_detached_automatic_refill_failure/migration.sql",
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
    expect(
      `${migrationSql}\n${contractMigrationSql}\n${detachedDirectProofMigrationSql}`,
    ).not.toMatch(
      /funding_code|funding_token/iu,
    );
  });

  it("predeploys the backward-compatible detached direct-payment proof", () => {
    expect(detachedDirectProofMigrationSql).toContain(
      'DROP CONSTRAINT IF EXISTS "hosted_usage_credit_purchase_active_payer_required"',
    );
    expect(detachedDirectProofMigrationSql).toContain(
      'DROP CONSTRAINT IF EXISTS "hosted_usage_credit_purchase_deleted_payer_ciphertext_cleared"',
    );
    expect(detachedDirectProofMigrationSql.match(/NOT VALID/gu)).toHaveLength(2);
    expect(
      detachedDirectProofMigrationSql.match(/VALIDATE CONSTRAINT/gu),
    ).toHaveLength(2);
    const fulfilledArm = detachedDirectProofMigrationSql.match(
      /"status" = 'fulfilled'[\s\S]*?"stripe_charge_lookup_key" IS NOT NULL/iu,
    )?.[0];
    expect(fulfilledArm).toBeDefined();
    expect(fulfilledArm).toContain(
      '"stripe_payment_intent_lookup_key" IS NOT NULL',
    );
    expect(fulfilledArm).not.toContain(
      '"stripe_checkout_session_lookup_key" IS NOT NULL',
    );
  });

  it("accepts only an exact detached terminal automatic-refill failure", () => {
    expect(detachedAutomaticRefillFailureMigrationSql).toContain(
      'DROP CONSTRAINT IF EXISTS "hosted_usage_credit_purchase_active_payer_required"',
    );
    expect(detachedAutomaticRefillFailureMigrationSql).toContain(
      '"status" = \'payment_failed\'',
    );
    expect(detachedAutomaticRefillFailureMigrationSql).toContain(
      '"group_sponsorship_authorization_id" IS NOT NULL',
    );
    expect(detachedAutomaticRefillFailureMigrationSql).toContain(
      '"group_sponsorship_charge_ordinal" > 0',
    );
    expect(detachedAutomaticRefillFailureMigrationSql).toContain(
      '"stripe_checkout_session_lookup_key" IS NULL',
    );
    expect(detachedAutomaticRefillFailureMigrationSql).toContain(
      '"stripe_payment_intent_lookup_key" IS NULL',
    );
    expect(detachedAutomaticRefillFailureMigrationSql).toContain(
      '"stripe_charge_lookup_key" IS NULL',
    );
    expect(detachedAutomaticRefillFailureMigrationSql.match(/NOT VALID/gu)).toHaveLength(1);
    expect(
      detachedAutomaticRefillFailureMigrationSql.match(/VALIDATE CONSTRAINT/gu),
    ).toHaveLength(1);
  });
});
