import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260812030300_referral_handoff_indexes/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("referral and handoff indexes", () => {
  it("adds only the four concurrent partial recovery paths", () => {
    expect(migrationSql).toContain(
      'ON "hosted_mailbox_item"("occurred_at", "user_id", "id")',
    );
    expect(migrationSql).toContain('WHERE "kind" = \'member.activated\'');
    expect(migrationSql).toContain(
      'CREATE INDEX CONCURRENTLY "hosted_mailbox_preference_handoff_user_lane_idx"',
    );
    expect(migrationSql).toContain(
      'CREATE INDEX CONCURRENTLY "hosted_mailbox_vault_refresh_user_lane_idx"',
    );
    expect(migrationSql).toContain(
      '"celebration_queued_at",\n    "beneficiary_member_id",\n    "id"',
    );
    expect(migrationSql.match(/CREATE INDEX CONCURRENTLY/gu)).toHaveLength(4);
    expect(migrationSql).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|ALTER TABLE|CREATE TABLE)\b/u,
    );
  });
});
