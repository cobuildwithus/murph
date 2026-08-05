import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("hosted signup referral attribution migration", () => {
  it("adds nullable indexed attribution with non-destructive deletion semantics", () => {
    const migrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260804223000_hosted_signup_referral_attribution/migration.sql",
        import.meta.url,
      ),
      "utf8",
    ).replace(/\s+/gu, " ");

    expect(migrationSql).toContain(
      'ALTER TABLE "hosted_invite" ADD COLUMN "referrer_member_id" TEXT',
    );
    expect(migrationSql).toContain(
      'CREATE INDEX "hosted_invite_referrer_member_id_created_at_idx" ON "hosted_invite"("referrer_member_id", "created_at")',
    );
    expect(migrationSql).toContain(
      'FOREIGN KEY ("referrer_member_id") REFERENCES "hosted_member"("id") ON DELETE SET NULL ON UPDATE CASCADE',
    );
  });
});
