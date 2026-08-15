import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260812030000_hosted_stripe_activation_result_pointer/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("hosted Stripe activation result pointer migration", () => {
  it("adds one nullable additive receipt-owned result field", () => {
    expect(migrationSql.trim()).toBe(
      'ALTER TABLE "hosted_stripe_event"\n  ADD COLUMN "activation_result_json" JSONB;',
    );
    expect(migrationSql).not.toMatch(/\b(?:UPDATE|DELETE|DROP)\b/u);
  });
});
