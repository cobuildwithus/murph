import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const expandMigrationSql = readFileSync(
  fileURLToPath(new URL(
    "../prisma/migrations/20260806170000_hosted_pulse_trial_start_source/migration.sql",
    import.meta.url,
  )),
  "utf8",
);
const contractMigrationSql = readFileSync(
  fileURLToPath(new URL(
    "../prisma/contract-migrations/20260806222000_validate_hosted_pulse_trial_start_source/migration.sql",
    import.meta.url,
  )),
  "utf8",
);

describe("hosted Pulse trial start-source migration", () => {
  it("keeps predeploy limited to the nullable provenance expansion", () => {
    expect(expandMigrationSql).toContain(
      'ADD COLUMN "pulse_trial_start_source" TEXT',
    );
    expect(expandMigrationSql).not.toMatch(/ADD CONSTRAINT|CHECK/iu);
    expect(expandMigrationSql).not.toMatch(/\bUPDATE\b/iu);
  });

  it("validates the supported provenance vocabulary only after deployment", () => {
    expect(contractMigrationSql).toContain(
      '"pulse_trial_start_source" IS NOT NULL',
    );
    expect(contractMigrationSql).toContain(
      '"pulse_trial_start_source" IS NULL',
    );
    expect(contractMigrationSql).toContain("'web_onboarding'");
    expect(contractMigrationSql).toContain("'companion_onboarding'");
    expect(contractMigrationSql).toContain("'linq_instant_start'");
    expect(contractMigrationSql).toContain(
      'CHECK (\n        "pulse_trial_start_source" IS NULL',
    );
    expect(contractMigrationSql).toContain(") NOT VALID;");
    expect(contractMigrationSql).toContain(
      'VALIDATE CONSTRAINT "hosted_member_billing_ref_pulse_trial_start_source_check"',
    );
    expect(contractMigrationSql).not.toMatch(/\bUPDATE\b/iu);
  });
});
