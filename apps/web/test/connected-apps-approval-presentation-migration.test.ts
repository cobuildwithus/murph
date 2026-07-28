import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260728040000_connected_app_approval_presentation_encryption/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("connected-app approval presentation encryption migration", () => {
  it("adds encrypted storage with the final legacy-or-connected row modes", () => {
    expect(migrationSql).toContain(
      'ADD COLUMN "presentation_title_encrypted" TEXT',
    );
    expect(migrationSql).toContain(
      'ADD COLUMN "presentation_body_encrypted" TEXT',
    );
    expect(migrationSql).toContain(
      `"action_id" LIKE 'connected-app:%'
          AND "presentation_title" IS NULL
          AND "presentation_body" IS NULL
          AND "presentation_title_encrypted" IS NOT NULL
          AND "presentation_body_encrypted" IS NOT NULL`,
    );
    expect(migrationSql).toContain(
      `"action_id" NOT LIKE 'connected-app:%'
          AND "presentation_title" IS NOT NULL
          AND "presentation_body" IS NOT NULL
          AND "presentation_title_encrypted" IS NULL
          AND "presentation_body_encrypted" IS NULL`,
    );
    expect(migrationSql).not.toMatch(/\bDELETE\s+FROM\b/iu);
    expect(migrationSql).not.toContain(
      "old code may write the plaintext-only form",
    );
  });
});
