import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(new URL(
  "../prisma/migrations/20260826190000_hosted_vault_share_delivery_cursor_index/migration.sql",
  import.meta.url,
));

describe("hosted vault-share delivery cursor index migration", () => {
  it("adds the active grantor/scope/destination cursor index concurrently", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain(
      'ADD COLUMN "projection_source_workspace_version" BIGINT',
    );
    expect(sql).toContain(
      'CREATE INDEX CONCURRENTLY "hosted_vault_share_active_grantor_scope_destination_idx"',
    );
    expect(sql).toContain(
      'ON "hosted_vault_share"("grantor_member_id", "projection_scope_key", "destination_member_id")',
    );
    expect(sql).toContain('WHERE "status" = \'granted\'');
    expect(sql.match(/CONCURRENTLY/gu)).toHaveLength(1);
    expect(sql).not.toContain("DROP INDEX");
  });
});
