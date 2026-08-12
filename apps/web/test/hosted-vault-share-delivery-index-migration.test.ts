import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(new URL(
  "../prisma/migrations/20260812053000_hosted_vault_share_delivery_page_index/migration.sql",
  import.meta.url,
));

describe("hosted vault-share delivery page index migration", () => {
  it("bounds the active grantor/scope cursor read and removes its prefix index", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain(
      'CREATE INDEX CONCURRENTLY "hosted_vault_share_active_grantor_scope_id_idx"',
    );
    expect(sql).toContain(
      'ON "hosted_vault_share"("grantor_member_id", "projection_scope_key", "id")',
    );
    expect(sql).toContain('WHERE "status" = \'granted\'');
    expect(sql).toContain(
      'DROP INDEX CONCURRENTLY "hosted_vault_share_active_grantor_scope_idx"',
    );
  });
});
