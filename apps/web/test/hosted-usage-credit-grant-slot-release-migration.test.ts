import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const PRISMA_SCHEMA = readFileSync(
  new URL("../prisma/schema.prisma", import.meta.url),
  "utf8",
);
const EXPAND_MIGRATION = readFileSync(
  new URL(
    "../prisma/migrations/20260810150000_hosted_usage_credit_grant_slot_release/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("hosted usage-credit grant-slot release migration", () => {
  it("adds one nullable provider-final release fact", () => {
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
  });

  it("leaves every existing purchase conservatively unreleased", () => {
    expect(EXPAND_MIGRATION).not.toMatch(/\b(?:UPDATE|DELETE|INSERT)\b/iu);
    expect(EXPAND_MIGRATION).not.toMatch(
      /"grant_slot_released_at"[^;]*(?:NOT NULL|DEFAULT)/iu,
    );
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
