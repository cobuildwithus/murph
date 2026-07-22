import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("hosted Codex auth access-seed migration", () => {
  it("adds the nullable ciphertext/expiry pair as an expand-only migration", () => {
    const sql = readFileSync(
      new URL(
        "../prisma/migrations/20260721210000_hosted_codex_auth_access_seed/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(sql).toContain('ADD COLUMN "access_seed_encrypted" TEXT');
    expect(sql).toContain('ADD COLUMN "access_seed_expires_at" TIMESTAMP(3)');
    expect(sql).not.toMatch(/\bADD\s+CONSTRAINT\b/iu);
    expect(sql).not.toMatch(/\bUPDATE\b/iu);
  });
});
