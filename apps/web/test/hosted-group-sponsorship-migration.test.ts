import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260727190000_hosted_group_sponsorship_moment/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("hosted group sponsorship migration", () => {
  it("adds one purchase-linked content record without a second financial state", () => {
    expect(migrationSql).toContain(
      'CREATE TABLE "hosted_group_sponsorship_moment"',
    );
    expect(migrationSql).toContain('"purchase_id" TEXT NOT NULL');
    expect(migrationSql).toContain('"configuration_digest" TEXT NOT NULL');
    expect(migrationSql).not.toMatch(
      /cash_amount|grant_usd|remaining_credit|stripe_/iu,
    );
  });

  it("deletes authored content with its creator while preserving the purchase owner", () => {
    expect(migrationSql).toMatch(
      /FOREIGN KEY \("creator_member_id"\)\s+REFERENCES "hosted_member"\("id"\)\s+ON DELETE CASCADE/iu,
    );
    expect(migrationSql).toMatch(
      /FOREIGN KEY \("purchase_id"\)\s+REFERENCES "hosted_usage_credit_purchase"\("id"\)\s+ON DELETE CASCADE/iu,
    );
  });
});
