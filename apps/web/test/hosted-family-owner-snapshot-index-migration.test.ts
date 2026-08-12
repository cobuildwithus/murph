import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260812032000_family_owner_snapshot_accepted_invite_index/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("Family owner snapshot accepted-invite index", () => {
  it("matches the bounded current-member lateral lookup", () => {
    expect(migrationSql).toContain(
      '"group_id",\n    "accepted_by_member_id",\n    "created_at",\n    "id"',
    );
    expect(migrationSql).toContain('WHERE "status" = \'accepted\'');
    expect(migrationSql).toContain(
      'AND "accepted_by_member_id" IS NOT NULL',
    );
    expect(migrationSql).toContain("CREATE INDEX CONCURRENTLY");
    expect(migrationSql).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|ALTER TABLE|CREATE TABLE)\b/u,
    );
  });
});
