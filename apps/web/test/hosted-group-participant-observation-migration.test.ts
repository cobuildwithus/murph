import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("group participant observation migration", () => {
  it("stores only blinded expiring contact evidence", () => {
    const migration = readFileSync(
      new URL(
        "../prisma/migrations/20260826120000_hosted_group_participant_observation/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain(
      'CREATE TABLE "hosted_group_participant_observation"',
    );
    expect(migration).toContain('"contact_lookup_key" TEXT NOT NULL');
    expect(migration).toContain('"first_observed_at" TIMESTAMP(3) NOT NULL');
    expect(migration).toContain('"expires_at" TIMESTAMP(3) NOT NULL');
    expect(migration).toContain(
      'PRIMARY KEY ("contact_lookup_key")',
    );
    expect(migration).toContain(
      'ON "hosted_group_participant_observation"("expires_at", "contact_lookup_key")',
    );
    expect(migration).not.toMatch(/phone|email|group_id|member_id|route_id/iu);
  });
});
