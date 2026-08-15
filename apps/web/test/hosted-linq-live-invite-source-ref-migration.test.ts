import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260812070000_hosted_linq_live_invite_source_ref/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("Hosted Linq live invite source-ref migration", () => {
  it("adds only the concurrent partial pattern index for live signup attempts", () => {
    expect(migrationSql.trim()).toBe([
      'CREATE INDEX CONCURRENTLY "hosted_linq_delivery_live_invite_source_ref_pattern_idx"',
      '  ON "hosted_linq_delivery"("source_ref" text_pattern_ops)',
      '  WHERE "source_ref" IS NOT NULL',
      "    AND \"template\" IN ('invite_signup', 'invite_signup_fallback')",
      '    AND "status" IN (',
      "      'attempted',",
      "      'provider_dispatch_started',",
      "      'accepted',",
      "      'delivered'",
      '    );',
    ].join("\n"));
  });
});
