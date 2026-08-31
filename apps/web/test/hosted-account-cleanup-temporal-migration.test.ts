import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  testDirectory,
  "../prisma/migrations/20260830170000_hosted_account_cleanup_temporal/migration.sql",
);
const contractMigrationPath = path.resolve(
  testDirectory,
  "../prisma/contract-migrations/20260831060000_require_hosted_account_cleanup_temporal_cursor/migration.sql",
);

describe("hosted account cleanup Temporal migration", () => {
  it("expands retry ownership before requiring the cursor postdeploy", async () => {
    const [migration, contractMigration] = await Promise.all([
      readFile(migrationPath, "utf8"),
      readFile(contractMigrationPath, "utf8"),
    ]);

    expect(migration).toContain(
      'ADD COLUMN "temporal_completed_at" TIMESTAMP(3),',
    );
    expect(migration).not.toContain(
      'temporal_completed_at" TIMESTAMP(3) DEFAULT',
    );
    expect(migration).toContain(
      'ADD COLUMN "temporal_next_runtime_index" INTEGER DEFAULT 0;',
    );
    expect(migration).not.toMatch(
      /ADD COLUMN "temporal_next_runtime_index"[^;]*NOT NULL/u,
    );
    expect(migration).toContain(
      'IF OLD."temporal_completed_at" IS NULL THEN',
    );
    expect(migration).toContain(
      'CREATE TRIGGER "hosted_account_deletion_cleanup_temporal_delete_guard"',
    );
    expect(contractMigration).toContain(
      'WHERE "temporal_next_runtime_index" IS NULL',
    );
    expect(contractMigration).toContain(
      "Cannot require the Temporal cleanup cursor while a NULL value remains.",
    );
    expect(contractMigration).toContain(
      'ALTER COLUMN "temporal_next_runtime_index" SET NOT NULL;',
    );
  });
});
