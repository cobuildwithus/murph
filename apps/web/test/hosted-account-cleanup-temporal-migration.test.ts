import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  testDirectory,
  "../prisma/migrations/20260830170000_hosted_account_cleanup_temporal/migration.sql",
);

describe("hosted account cleanup Temporal migration", () => {
  it("adds nullable retry ownership and blocks legacy receipt deletion", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain(
      'ADD COLUMN "temporal_completed_at" TIMESTAMP(3);',
    );
    expect(migration).not.toContain(
      'temporal_completed_at" TIMESTAMP(3) DEFAULT',
    );
    expect(migration).toContain(
      'IF OLD."temporal_completed_at" IS NULL THEN',
    );
    expect(migration).toContain(
      'CREATE TRIGGER "hosted_account_deletion_cleanup_temporal_delete_guard"',
    );
  });
});
