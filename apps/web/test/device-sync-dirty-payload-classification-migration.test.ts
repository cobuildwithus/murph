import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(import.meta.dirname, "..");
const SCHEMA = readFileSync(
  path.join(WEB_ROOT, "prisma/schema.prisma"),
  "utf8",
);
const MIGRATION = readFileSync(
  path.join(
    WEB_ROOT,
    "prisma/migrations/20260810020000_device_sync_dirty_payload_credential_independence/migration.sql",
  ),
  "utf8",
);

describe("device-sync dirty payload credential classification migration", () => {
  it("adds one nullable server-owned classification bit for mixed-version rollout", () => {
    const model = readPrismaModel(SCHEMA, "DeviceSyncDirtyPayload");

    expect(model).toMatch(
      /credentialIndependent\s+Boolean\?\s+@map\("credential_independent"\)/u,
    );
    expect(MIGRATION).toContain(
      'ADD COLUMN "credential_independent" BOOLEAN',
    );
    expect(MIGRATION).not.toContain("NOT NULL");
    expect(MIGRATION).not.toContain("DEFAULT");
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
