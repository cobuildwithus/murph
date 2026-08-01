import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const forwardMigrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260731120000_anonymize_hosted_product_feedback/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const postDrainMigrationSql = readFileSync(
  new URL(
    "../prisma/contract-migrations/20260731123000_anonymize_product_feedback_after_drain/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("hosted product feedback privacy migration", () => {
  it("makes member linkage nullable before clearing every existing association", () => {
    const dropNotNullIndex = forwardMigrationSql.indexOf(
      'ALTER COLUMN "member_id" DROP NOT NULL',
    );
    const clearAssociationsIndex = forwardMigrationSql.indexOf(
      '"member_id" = NULL',
    );

    expect(dropNotNullIndex).toBeGreaterThanOrEqual(0);
    expect(clearAssociationsIndex).toBeGreaterThan(dropNotNullIndex);
    expectAnonymizationCleanup(forwardMigrationSql);
  });

  it("repeats the unlink after old application writers have drained", () => {
    expectAnonymizationCleanup(postDrainMigrationSql);
    expect(postDrainMigrationSql).not.toContain("ALTER TABLE");
  });

  it("preserves feedback summaries while removing identity", () => {
    expect(forwardMigrationSql).not.toContain('"summary"');
    expect(postDrainMigrationSql).not.toContain('"summary"');
  });
});

function expectAnonymizationCleanup(sql: string): void {
  expect(sql).toContain(
    '"id" = \'product_feedback_\' || replace(gen_random_uuid()::text, \'-\', \'\')',
  );
  expect(sql).toContain('"member_id" = NULL');
  expect(sql).toContain('WHERE "member_id" IS NOT NULL');
  expect(sql).not.toMatch(
    /\b(?:INSERT|CREATE TABLE|ADD COLUMN|RENAME COLUMN)\b/iu,
  );
}
