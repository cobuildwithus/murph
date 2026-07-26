import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("hosted account deletion cleanup migration", () => {
  it("adds only the foreign-key-free encrypted retry receipt", () => {
    const migration = readFileSync(
      new URL(
        "../prisma/migrations/20260726210000_hosted_account_deletion_cleanup/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const schema = readFileSync(
      new URL("../prisma/schema.prisma", import.meta.url),
      "utf8",
    );

    expect(migration).toContain('CREATE TABLE "hosted_account_deletion_cleanup"');
    expect(migration).toContain('"payload_ciphertext" TEXT NOT NULL');
    expect(migration).toContain('"kms_key_name" TEXT NOT NULL');
    expect(migration).toContain('"next_attempt_at" TIMESTAMP(3) NOT NULL');
    expect(migration).toContain(
      'CREATE INDEX "hosted_account_deletion_cleanup_next_attempt_at_created_at_idx"',
    );
    expect(migration).not.toMatch(/REFERENCES|FOREIGN KEY|member_id/iu);
    expect(migration).not.toMatch(/DROP\s+(?:TABLE|COLUMN)|ALTER\s+COLUMN/iu);

    expect(schema).toMatch(/model HostedAccountDeletionCleanup \{/u);
    expect(schema).toMatch(/payloadCiphertext\s+String\s+@map\("payload_ciphertext"\)/u);
    expect(schema).not.toMatch(
      /model HostedAccountDeletionCleanup \{[^}]*@relation/su,
    );
  });
});
