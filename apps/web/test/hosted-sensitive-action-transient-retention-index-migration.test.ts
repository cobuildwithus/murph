import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260812050000_hosted_sensitive_action_transient_retention_index/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const cleanupSource = readFileSync(
  new URL("../src/lib/hosted-retention/cleanup.ts", import.meta.url),
  "utf8",
);

describe("Hosted sensitive-action transient retention index migration", () => {
  it("keeps durable approval history out of the bounded transient claim path", () => {
    expect(migrationSql.trim()).toBe([
      'CREATE INDEX CONCURRENTLY "hosted_sensitive_action_challenge_transient_retention_idx"',
      '  ON "hosted_sensitive_action_challenge"("expires_at", "token_hash")',
      '  WHERE "approval_key" IS NULL;',
    ].join("\n"));
    expect(cleanupSource).toContain([
      '      WHERE challenge."approval_key" IS NULL',
      '        AND challenge."expires_at" <= ${input.now}',
      '      ORDER BY challenge."expires_at" ASC, challenge."token_hash" ASC',
      '      LIMIT ${HOSTED_CONTROL_ARTIFACT_RETENTION_BATCH_SIZE}',
      "      FOR UPDATE OF challenge SKIP LOCKED",
    ].join("\n"));
  });
});
