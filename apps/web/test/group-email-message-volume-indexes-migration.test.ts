import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260812030100_group_email_message_volume_indexes/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("group-email and message-volume indexes", () => {
  it("matches each retained index to its predicate and ordering path", () => {
    expect(migrationSql).toContain(
      'ON "hosted_group_member"("group_id", "created_at", "id")',
    );
    expect(migrationSql).toContain(
      '"grantor_member_id",\n    "destination_member_id",\n    "projection_scope_key",\n    "id"',
    );
    expect(migrationSql).toContain('WHERE "status" = \'granted\'');
    expect(migrationSql).toContain(
      'ON "hosted_mailbox_item"("occurred_at")\n  WHERE "kind" = \'conversation.message\'',
    );
  });

  it("uses concurrent, partial indexes without changing stored rows", () => {
    expect(migrationSql.match(/CREATE INDEX CONCURRENTLY/gu)).toHaveLength(3);
    expect(migrationSql).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|ALTER TABLE|CREATE TABLE)\b/u,
    );
  });
});
