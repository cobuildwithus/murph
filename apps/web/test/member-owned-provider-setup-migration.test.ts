import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migration = readFileSync(
  join(
    webRoot,
    "prisma/migrations/20260811100000_member_owned_provider_setup/migration.sql",
  ),
  "utf8",
);
const friendlyNameMigration = readFileSync(
  join(
    webRoot,
    "prisma/migrations/20260814180000_provider_setup_friendly_application_name/migration.sql",
  ),
  "utf8",
);
const schema = readFileSync(join(webRoot, "prisma/schema.prisma"), "utf8");

describe("member-owned provider setup migration", () => {
  it("adds the durable setup owner and exact browser/application bindings with expand-safe constraints", () => {
    expect(migration).toContain('ADD COLUMN "owner_purpose" TEXT');
    expect(migration).toContain('ADD COLUMN "owner_key" TEXT');
    expect(migration).toContain('CREATE TABLE "device_provider_setup"');
    expect(friendlyNameMigration).toContain(
      'ADD COLUMN "application_name" TEXT',
    );
    expect(migration).toContain('WHERE "active" = TRUE');
    expect(migration).toContain('REFERENCES "device_provider_application"("id")');
    expect(migration).toContain('REFERENCES "hosted_computer_run"("id")');
    expect(migration).not.toMatch(/ADD\s+CONSTRAINT[^;]+CHECK/iu);
    expect(migration).not.toMatch(/CHECK\s*\(/iu);
  });

  it("derives provider-setup intent kind from the nullable durable setup binding", () => {
    expect(migration).toContain('ADD COLUMN "provider_setup_id" TEXT');
    expect(migration).not.toContain("intent_kind");
    expect(schema).not.toContain("intentKind");
    expect(migration).toContain(
      'FOREIGN KEY ("provider_setup_id") REFERENCES "device_provider_setup"("id")',
    );
    expect(schema).toMatch(/providerSetup\s+DeviceProviderSetup\?/u);
    expect(schema).toMatch(/connectIntents\s+DeviceConnectIntent\[\]/u);
    expect(schema).toMatch(/deviceProviderSetups\s+DeviceProviderSetup\[\]/u);
  });
});
