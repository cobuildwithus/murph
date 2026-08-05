import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260729154500_hosted_linq_recent_message_load/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("Hosted Linq recent message load migration", () => {
  it("adds only the two concurrent partial indexes used by the bounded read", () => {
    expect(migrationSql).toContain(
      'CREATE INDEX CONCURRENTLY "hosted_linq_delivery_line_accepted_at_idx"',
    );
    expect(migrationSql).toContain(
      'ON "hosted_linq_delivery"("phone_number_lookup_key", "accepted_at")',
    );
    expect(migrationSql).toContain(
      'AND "accepted_at" IS NOT NULL',
    );
    expect(migrationSql).toContain(
      'CREATE INDEX CONCURRENTLY "hosted_linq_provider_event_line_inbound_received_at_idx"',
    );
    expect(migrationSql).toContain(
      'ON "hosted_linq_provider_event"("phone_number_lookup_key", "received_at")',
    );
    expect(migrationSql).toContain(
      'AND "event_type" = \'message.received\'',
    );
    expect(migrationSql).toContain(
      'AND "direction" = \'inbound\'',
    );
    expect(migrationSql).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|ALTER TABLE|CREATE TABLE)\b/u,
    );
  });
});
