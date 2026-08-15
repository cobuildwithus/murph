import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260812030200_whoop_capacity_index/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("WHOOP capacity indexes", () => {
  it("adds both active source paths used before LIMIT", () => {
    expect(migrationSql).toContain(
      'CREATE INDEX CONCURRENTLY "device_connection_active_provider_member_idx"',
    );
    expect(migrationSql).toContain(
      'ON "device_connection"("provider", "user_id")',
    );
    expect(migrationSql).toContain(
      'ON "device_connection_source"("source_provider_slug", "connection_id")',
    );
    expect(migrationSql.match(/CREATE INDEX CONCURRENTLY/gu)).toHaveLength(2);
    expect(migrationSql).toContain('WHERE "status" <> \'disconnected\'');
    expect(migrationSql).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|ALTER TABLE|CREATE TABLE)\b/u,
    );
  });
});
