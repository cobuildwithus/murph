import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync(
  new URL("../prisma/schema.prisma", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL(
    "../prisma/migrations/20260726120000_hosted_growth_aggregate/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("hosted growth aggregate migration", () => {
  it("creates and seeds one anonymous nonnegative lifetime counter", () => {
    expect(schema).toContain("model HostedGrowthAggregate");
    expect(schema).toContain("fulfilledUsageTopUps");
    expect(migration).toContain('CREATE TABLE "hosted_growth_aggregate"');
    expect(migration).toContain('CHECK ("id" = \'global\')');
    expect(migration).toContain('CHECK ("fulfilled_usage_top_ups" >= 0)');
    expect(migration).toContain("COUNT(*)::INTEGER");
    expect(migration).toContain('WHERE "status" = \'fulfilled\'');
    expect(migration).toContain(
      'CREATE TRIGGER "hosted_usage_credit_purchase_growth_total"',
    );
    expect(migration).toContain('AFTER UPDATE OF "status"');
    expect(migration).toContain(
      'OLD."status" IS DISTINCT FROM \'fulfilled\'',
    );
    expect(migration).toContain('NEW."status" = \'fulfilled\'');
  });

  it("stores no member, purchase, provider, event, or timing reference", () => {
    expect(migration).not.toMatch(
      /member|payer|beneficiary|purchase_id|stripe|event|timestamp|updated_at|created_at/iu,
    );
  });
});
