import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("hosted-member privacy foundation migration", () => {
  it("creates the additive hosted-member tables and backfills them from hosted_member", () => {
    const migrationSql = readFileSync(
      new URL("../prisma/migrations/2026040604_hosted_member_privacy_foundation/migration.sql", import.meta.url),
      "utf8",
    );

    expect(migrationSql).toContain('CREATE TABLE "hosted_member_identity"');
    expect(migrationSql).toContain('CREATE TABLE "hosted_member_routing"');
    expect(migrationSql).toContain('CREATE TABLE "hosted_member_billing_ref"');
    expect(migrationSql).toContain('INSERT INTO "hosted_member_identity"');
    expect(migrationSql).toContain('INSERT INTO "hosted_member_routing"');
    expect(migrationSql).toContain('INSERT INTO "hosted_member_billing_ref"');
    expect(migrationSql).toContain('FROM "hosted_member";');
    expect(migrationSql).not.toContain("email");
    expect(migrationSql).not.toContain('"hosted_session"');
  });

  it("drops hosted_session and telegram username storage in the cleanup migration", () => {
    const migrationSql = readFileSync(
      new URL("../prisma/migrations/2026040605_hosted_member_privacy_cleanup/migration.sql", import.meta.url),
      "utf8",
    );

    expect(migrationSql).toContain('ALTER TABLE "hosted_member_routing"');
    expect(migrationSql).toContain('DROP COLUMN "telegram_username"');
    expect(migrationSql).toContain('DROP TABLE "hosted_session"');
  });

  it("hard-cuts legacy identity, routing, and billing columns off hosted_member", () => {
    const migrationSql = readFileSync(
      new URL("../prisma/migrations/2026040606_hosted_member_privacy_hard_cut/migration.sql", import.meta.url),
      "utf8",
    );

    expect(migrationSql).toContain('ALTER TABLE "hosted_member"');
    expect(migrationSql).toContain('DROP COLUMN "normalized_phone_number"');
    expect(migrationSql).toContain('DROP COLUMN "privy_user_id"');
    expect(migrationSql).toContain('DROP COLUMN "wallet_address"');
    expect(migrationSql).toContain('DROP COLUMN "stripe_customer_id"');
    expect(migrationSql).toContain('DROP COLUMN "linq_chat_id"');
    expect(migrationSql).toContain('DROP COLUMN "telegram_username"');
    expect(migrationSql).not.toContain("email");
  });
});
