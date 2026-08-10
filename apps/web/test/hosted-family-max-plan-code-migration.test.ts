import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260809160000_add_hosted_family_max_plan_code/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("hosted Family Max plan-code migration", () => {
  it("owns the complete non-null three-tier assignment contract", () => {
    expect(migrationSql.match(/"plan_code" IS NULL/gu)).toHaveLength(2);
    expect(
      migrationSql.match(/"plan_code" NOT IN \('pulse', 'edge', 'max'\)/gu),
    ).toHaveLength(2);
    expect(
      migrationSql.match(/ALTER COLUMN "plan_code" SET NOT NULL/gu),
    ).toHaveLength(2);
    expect(migrationSql.match(/CHECK \("plan_code" IN \('pulse', 'edge', 'max'\)\)/gu))
      .toHaveLength(3);
    expect(migrationSql.match(/VALIDATE CONSTRAINT/gu)).toHaveLength(3);
    expect(migrationSql.match(/DROP CONSTRAINT IF EXISTS/gu)).toHaveLength(3);
    expect(migrationSql).toContain(
      '"hosted_account_group_membership_plan_code_check"',
    );
    expect(migrationSql).toContain(
      '"hosted_account_group_invite_plan_code_check"',
    );
    expect(migrationSql).toContain(
      '"hosted_account_group_plan_capacity_plan_code_check"',
    );
    expect(migrationSql).toContain("USING ERRCODE = 'check_violation'");
    expect(migrationSql).not.toMatch(/\b(?:UPDATE|DELETE|INSERT)\b/iu);
  });
});
