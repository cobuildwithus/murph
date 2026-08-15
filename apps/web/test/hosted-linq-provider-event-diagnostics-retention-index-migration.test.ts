import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260811190000_hosted_linq_provider_event_diagnostics_retention_index/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const cleanupSource = readFileSync(
  new URL("../src/lib/hosted-retention/cleanup.ts", import.meta.url),
  "utf8",
);
const prismaSchema = readFileSync(
  new URL("../prisma/schema.prisma", import.meta.url),
  "utf8",
);

describe("Hosted Linq provider-event diagnostics retention index migration", () => {
  it("adds only the concurrent partial index for the ordered compaction scan", () => {
    expect(migrationSql.trim()).toBe([
      'CREATE INDEX CONCURRENTLY "hosted_linq_provider_event_diagnostics_retention_idx"',
      '  ON "hosted_linq_provider_event"("received_at", "event_id")',
      '  WHERE "extraction_json" IS NOT NULL',
      '    OR "payload_sanitized_json" IS NOT NULL',
      '    OR "payload_shape_json" IS NOT NULL;',
    ].join("\n"));
    expect(cleanupSource).toContain([
      '      WHERE provider_event."received_at" < ${cutoff}',
      "        AND (",
      '          provider_event."extraction_json" IS NOT NULL',
      '          OR provider_event."payload_sanitized_json" IS NOT NULL',
      '          OR provider_event."payload_shape_json" IS NOT NULL',
      "        )",
      '      ORDER BY provider_event."received_at" ASC, provider_event."event_id" ASC',
    ].join("\n"));
    expect(prismaSchema).toContain("@@index([receivedAt, eventId])");
  });
});
