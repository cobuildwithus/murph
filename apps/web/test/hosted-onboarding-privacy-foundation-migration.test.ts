import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("hosted-member privacy foundation migration", () => {
  it("creates the split hosted-member tables in one greenfield baseline migration", () => {
    const migrationSql = readFileSync(
      new URL("../prisma/migrations/2026040604_hosted_member_privacy_greenfield_baseline/migration.sql", import.meta.url),
      "utf8",
    );

    expect(migrationSql).toContain('CREATE TABLE "hosted_member_identity"');
    expect(migrationSql).toContain('CREATE TABLE "hosted_member_routing"');
    expect(migrationSql).toContain('CREATE TABLE "hosted_member_billing_ref"');
    expect(migrationSql).toContain('CREATE UNIQUE INDEX "hosted_member_routing_linq_chat_id_key"');
    expect(migrationSql).toContain('DROP TABLE "hosted_session"');
    expect(migrationSql).toContain('ALTER TABLE "hosted_member"');
    expect(migrationSql).toContain('DROP COLUMN "normalized_phone_number"');
    expect(migrationSql).toContain('DROP COLUMN "privy_user_id"');
    expect(migrationSql).toContain('DROP COLUMN "wallet_address"');
    expect(migrationSql).toContain('DROP COLUMN "stripe_customer_id"');
    expect(migrationSql).toContain('DROP COLUMN "linq_chat_id"');
    expect(migrationSql).toContain('DROP COLUMN "telegram_username"');
    expect(migrationSql).not.toContain('INSERT INTO "hosted_member_identity"');
    expect(migrationSql).not.toContain('INSERT INTO "hosted_member_routing"');
    expect(migrationSql).not.toContain('INSERT INTO "hosted_member_billing_ref"');
    expect(migrationSql).not.toContain("email");
  });
});
