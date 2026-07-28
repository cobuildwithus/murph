import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const expandMigration = readFileSync(
  new URL(
    "../prisma/migrations/20260728040000_connected_app_approval_presentation_encryption/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const contractMigration = readFileSync(
  new URL(
    "../prisma/contract-migrations/20260728050000_require_connected_app_approval_presentation_encryption/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("connected-app approval presentation encryption migrations", () => {
  it("expands storage without a plaintext-and-ciphertext mixed form", () => {
    expect(expandMigration).toContain(
      'ADD COLUMN "presentation_title_encrypted" TEXT',
    );
    expect(expandMigration).toContain(
      'ADD COLUMN "presentation_body_encrypted" TEXT',
    );
    expect(expandMigration).toContain(
      `"presentation_title" IS NOT NULL
              AND "presentation_body" IS NOT NULL
              AND "presentation_title_encrypted" IS NULL
              AND "presentation_body_encrypted" IS NULL`,
    );
    expect(expandMigration).toContain(
      `"presentation_title" IS NULL
              AND "presentation_body" IS NULL
              AND "presentation_title_encrypted" IS NOT NULL
              AND "presentation_body_encrypted" IS NOT NULL`,
    );
    expect(expandMigration).not.toMatch(/\bDELETE\s+FROM\b/iu);
  });

  it("invalidates old plaintext approvals after drain and requires encryption", () => {
    expect(contractMigration).toContain(
      'DELETE FROM "hosted_sensitive_action_challenge"',
    );
    expect(contractMigration).toContain(
      `"action_id" LIKE 'connected-app:%'
  AND "presentation_title_encrypted" IS NULL
  AND "presentation_body_encrypted" IS NULL`,
    );
    expect(contractMigration).toContain(
      `"action_id" LIKE 'connected-app:%'
          AND "presentation_title" IS NULL
          AND "presentation_body" IS NULL
          AND "presentation_title_encrypted" IS NOT NULL
          AND "presentation_body_encrypted" IS NOT NULL`,
    );
  });
});
