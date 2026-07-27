import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../prisma/migrations/20260726180000_hosted_account_deletion_cleanup/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("hosted account deletion cleanup migration", () => {
  it("creates a foreign-key-free retry receipt with encrypted payload and lease state", () => {
    expect(migration).toContain('CREATE TABLE "hosted_account_deletion_cleanup"');
    expect(migration).toContain('"payload_ciphertext" TEXT NOT NULL');
    expect(migration).toContain('"kms_key_name" TEXT NOT NULL');
    expect(migration).toContain('"cloudflare_completed_at" TIMESTAMP(3)');
    expect(migration).toContain('"stripe_completed_at" TIMESTAMP(3)');
    expect(migration).toContain('"privy_completed_at" TIMESTAMP(3)');
    expect(migration).toContain('"lease_token" TEXT');
    expect(migration).toContain('"next_attempt_at" TIMESTAMP(3) NOT NULL');
    expect(migration).toContain(
      'CREATE INDEX "hosted_account_deletion_cleanup_next_attempt_at_lease_expires_at_idx"',
    );
    expect(migration).not.toMatch(/FOREIGN KEY|REFERENCES/i);
    expect(migration).not.toMatch(/member_id|privy_user_id|stripe_customer_id/i);
  });
});
