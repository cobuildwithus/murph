import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  fileURLToPath(new URL(
    "../prisma/migrations/20260806170000_hosted_pulse_trial_start_source/migration.sql",
    import.meta.url,
  )),
  "utf8",
);

describe("hosted Pulse trial start-source migration", () => {
  it("adds nullable constrained provenance without guessing historical rows", () => {
    expect(migrationSql).toContain(
      'ADD COLUMN "pulse_trial_start_source" TEXT',
    );
    expect(migrationSql).toContain(
      '"pulse_trial_start_source" IS NULL',
    );
    expect(migrationSql).toContain("'web_onboarding'");
    expect(migrationSql).toContain("'companion_onboarding'");
    expect(migrationSql).toContain("'linq_instant_start'");
    expect(migrationSql).not.toMatch(/\bUPDATE\b/iu);
  });
});
