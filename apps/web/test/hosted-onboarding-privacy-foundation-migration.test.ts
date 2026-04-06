import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("hosted-member privacy foundation migration", () => {
  it("launches hosted onboarding in the final split-table shape from the init migration", () => {
    const initMigrationSql = readFileSync(
      new URL("../prisma/migrations/2026032602_hosted_onboarding_init/migration.sql", import.meta.url),
      "utf8",
    );
    const privacyCleanupSql = readFileSync(
      new URL("../prisma/migrations/2026040604_hosted_member_privacy_greenfield_baseline/migration.sql", import.meta.url),
      "utf8",
    );

    expect(initMigrationSql).toContain('create table "hosted_member_identity"');
    expect(initMigrationSql).toContain('create table "hosted_member_routing"');
    expect(initMigrationSql).toContain('create table "hosted_member_billing_ref"');
    expect(initMigrationSql).toContain('create unique index "hosted_member_routing_linq_chat_id_key"');
    expect(initMigrationSql).toContain('"masked_phone_number_hint" text not null');
    expect(initMigrationSql).toContain('"phone_lookup_key" text not null');
    expect(initMigrationSql).toContain('"telegram_user_lookup_key" text');
    expect(initMigrationSql).not.toContain('create table "hosted_session"');
    expect(initMigrationSql).not.toContain('"phone_number" text');
    expect(initMigrationSql).not.toContain('"normalized_phone_number" text');
    expect(initMigrationSql).not.toContain('"telegram_username" text');
    expect(initMigrationSql).not.toContain('"webauthn_user_id" text');
    expect(initMigrationSql).not.toContain("email");

    expect(privacyCleanupSql).toContain("Greenfield no-op");
  });
});
