import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const MIGRATION = readFileSync(
  new URL(
    "../prisma/migrations/20260811065000_normalize_browser_assertion_nonce_expiry/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("browser assertion nonce expiry migration", () => {
  it("normalizes old and current writers before backfilling existing rows", () => {
    expect(MIGRATION.trim()).toMatch(/^BEGIN;[\s\S]*COMMIT;$/u);
    expect(MIGRATION).toContain("SET LOCAL lock_timeout = '5s';");
    expect(MIGRATION).toContain(
      "CREATE FUNCTION normalize_device_browser_assertion_nonce_expiry()",
    );
    expect(MIGRATION).toContain(
      'NEW."expires_at" := NEW."expires_at" + INTERVAL \'61 seconds\';',
    );
    expect(MIGRATION).toContain(
      'BEFORE INSERT ON "device_browser_assertion_nonce"',
    );
    expect(MIGRATION).toContain(
      "EXECUTE FUNCTION normalize_device_browser_assertion_nonce_expiry();",
    );

    const triggerIndex = MIGRATION.indexOf(
      'CREATE TRIGGER "device_browser_assertion_nonce_expiry_normalizer"',
    );
    const backfillIndex = MIGRATION.indexOf(
      'UPDATE "device_browser_assertion_nonce"',
    );
    expect(triggerIndex).toBeGreaterThan(-1);
    expect(backfillIndex).toBeGreaterThan(triggerIndex);
    expect(MIGRATION).toContain(
      'SET "expires_at" = "expires_at" + INTERVAL \'61 seconds\';',
    );
  });
});
