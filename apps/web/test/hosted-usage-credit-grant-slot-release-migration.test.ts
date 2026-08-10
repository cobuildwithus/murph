import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const MIGRATION_ID =
  "20260810150000_hosted_usage_credit_grant_slot_release";
const MIGRATIONS_DIRECTORY = new URL("../prisma/migrations/", import.meta.url);
const PRISMA_SCHEMA = readFileSync(
  new URL("../prisma/schema.prisma", import.meta.url),
  "utf8",
);
const EXPAND_MIGRATION = readFileSync(
  new URL(`../prisma/migrations/${MIGRATION_ID}/migration.sql`, import.meta.url),
  "utf8",
);

describe("hosted usage-credit grant-slot release migration", () => {
  it("backfills only provider-verifiable expired reservations and keeps the fact nullable", () => {
    const model = readPrismaModel(
      PRISMA_SCHEMA,
      "HostedUsageCreditPurchase",
    );

    expect(model).toContain(
      'grantSlotReleasedAt               DateTime?                            @map("grant_slot_released_at")',
    );
    expect(EXPAND_MIGRATION).toContain(
      'ADD COLUMN "grant_slot_released_at" TIMESTAMP(3);',
    );
    expect(EXPAND_MIGRATION).toMatch(
      /UPDATE\s+"hosted_usage_credit_purchase"[\s\S]*?SET "grant_slot_released_at" = COALESCE\([\s\S]*?"last_reconciled_at",[\s\S]*?"terminal_at"[\s\S]*?\)[\s\S]*?WHERE[\s\S]*?"status" = 'expired'[\s\S]*?"paid_at" IS NULL[\s\S]*?"terminal_at" IS NOT NULL/u,
    );
    expect(EXPAND_MIGRATION).toMatch(
      /"stripe_checkout_session_lookup_key" IS NOT NULL/u,
    );
    expect(EXPAND_MIGRATION).toMatch(
      /"last_reconciled_at" IS NOT NULL[\s\S]*?"stripe_payment_intent_lookup_key" IS NOT NULL/u,
    );
    expect(EXPAND_MIGRATION).toMatch(
      /"last_reconciled_at" IS NOT NULL[\s\S]*?"group_sponsorship_charge_ordinal" IS NULL[\s\S]*?"group_sponsorship_charge_ordinal" = 0/u,
    );
    expect(EXPAND_MIGRATION).not.toMatch(
      /WHERE\s+"status" = 'expired'\s*;/u,
    );
  });

  it("adds required immutable canonical identity to the grant projection", () => {
    const model = readPrismaModel(PRISMA_SCHEMA, "HostedUsageCreditGrant");

    expect(EXPAND_MIGRATION.trim()).toMatch(/^BEGIN;[\s\S]*COMMIT;$/u);
    expect(model).toMatch(
      /beneficiaryMemberId\s+String\s+@map\("beneficiary_member_id"\)/u,
    );
    expect(model).toMatch(
      /beneficiarySequence\s+BigInt\s+@map\("beneficiary_sequence"\)/u,
    );
    expect(EXPAND_MIGRATION).toContain(
      'ADD COLUMN "beneficiary_member_id" TEXT,',
    );
    expect(EXPAND_MIGRATION).toContain(
      'ADD COLUMN "beneficiary_sequence" BIGINT;',
    );
    expect(EXPAND_MIGRATION).toMatch(
      /UPDATE\s+"hosted_usage_credit_grant"[\s\S]*?FROM\s+"hosted_usage_credit_entry"[\s\S]*?WHERE\s+entry\."id"\s*=\s*grant_projection\."entry_id";/u,
    );
    expect(EXPAND_MIGRATION).toContain(
      "CREATE FUNCTION enforce_hosted_usage_credit_grant_identity()",
    );
    expect(EXPAND_MIGRATION).toContain(
      'BEFORE INSERT ON "hosted_usage_credit_grant"',
    );
    expect(EXPAND_MIGRATION).toContain(
      'BEFORE UPDATE OF\n  "entry_id",\n  "beneficiary_member_id",\n  "beneficiary_sequence"',
    );
    expect(EXPAND_MIGRATION).toContain(
      "Hosted usage-credit grant canonical identity is immutable.",
    );
    expect(EXPAND_MIGRATION).toMatch(
      /NEW\."beneficiary_member_id"\s*:=\s*COALESCE\([\s\S]*?canonical_beneficiary_member_id/u,
    );
    expect(EXPAND_MIGRATION).toMatch(
      /NEW\."beneficiary_sequence"\s*:=\s*COALESCE\([\s\S]*?canonical_beneficiary_sequence/u,
    );
    expect(EXPAND_MIGRATION).toContain(
      'ALTER COLUMN "beneficiary_member_id" SET NOT NULL,',
    );
    expect(EXPAND_MIGRATION).toContain(
      'ALTER COLUMN "beneficiary_sequence" SET NOT NULL;',
    );
  });

  it("installs only projection-first partial indexes for the two bounded scans", () => {
    expect(EXPAND_MIGRATION).toMatch(
      /CREATE INDEX "hosted_usage_credit_grant_beneficiary_active_fifo_idx"[\s\S]*?ON "hosted_usage_credit_grant"\([\s\S]*?"beneficiary_member_id",[\s\S]*?"beneficiary_sequence"[\s\S]*?\)[\s\S]*?WHERE "remaining_usd_micros" > 0;/u,
    );
    expect(EXPAND_MIGRATION).toMatch(
      /CREATE INDEX "hosted_usage_credit_purchase_beneficiary_reserved_slot_idx"[\s\S]*?ON "hosted_usage_credit_purchase"\("beneficiary_member_id", "id"\)[\s\S]*?WHERE "status" <> 'fulfilled'[\s\S]*?AND "grant_slot_released_at" IS NULL;/u,
    );
  });

  it("extends the existing unshipped migration instead of adding another", () => {
    const matchingMigrationIds = readdirSync(MIGRATIONS_DIRECTORY, {
      withFileTypes: true,
    })
      .filter((entry) =>
        entry.isDirectory()
        && entry.name.endsWith("_hosted_usage_credit_grant_slot_release")
      )
      .map((entry) => entry.name);

    expect(matchingMigrationIds).toEqual([MIGRATION_ID]);
  });
});

function readPrismaModel(schema: string, name: string): string {
  const match = schema.match(
    new RegExp(`model ${name} \\{(?<body>[\\s\\S]*?)\\n\\}`, "u"),
  );
  if (!match?.groups?.body) {
    throw new Error(`Missing Prisma model ${name}.`);
  }
  return match.groups.body;
}
