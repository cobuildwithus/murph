import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260731120000_anonymize_hosted_product_feedback/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("hosted product feedback privacy migration", () => {
  it("makes member linkage nullable before clearing every existing association", () => {
    const dropNotNullIndex = migrationSql.indexOf(
      'ALTER COLUMN "member_id" DROP NOT NULL',
    );
    const clearAssociationsIndex = migrationSql.indexOf(
      '"member_id" = NULL',
    );

    expect(dropNotNullIndex).toBeGreaterThanOrEqual(0);
    expect(clearAssociationsIndex).toBeGreaterThan(dropNotNullIndex);
    expect(migrationSql).toContain(
      '"id" = \'product_feedback_\' || replace(gen_random_uuid()::text, \'-\', \'\')',
    );
    expect(migrationSql).toContain('WHERE "member_id" IS NOT NULL');
  });

  it("does not copy identity into another column or table", () => {
    expect(migrationSql).not.toMatch(
      /\b(?:INSERT|CREATE TABLE|ADD COLUMN|RENAME COLUMN)\b/iu,
    );
  });
});
