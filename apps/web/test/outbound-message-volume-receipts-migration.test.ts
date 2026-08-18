import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260815190000_outbound_message_volume_receipts/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("outbound message-volume receipt cutover migration", () => {
  it("creates only an anonymous exact-once receipt and receipt-time index", () => {
    expect(migrationSql).toContain(
      'PRIMARY KEY ("receipt_lookup_key")',
    );
    expect(migrationSql).toContain(
      'CHECK ("receipt_lookup_key" ~ \'^[0-9a-f]{64}$\')',
    );
    expect(migrationSql).toContain(
      'CHECK ("channel" IN (\'email\', \'telegram\'))',
    );
    expect(migrationSql).toContain(
      'ON "hosted_outbound_message_volume_receipt" ("recorded_at")',
    );

    const tableBody = migrationSql.match(
      /CREATE TABLE "hosted_outbound_message_volume_receipt" \(([\s\S]*?)\n\);/u,
    )?.[1] ?? "";
    expect(tableBody).not.toMatch(
      /\b(?:user|member|target|thread|provider|message)_id\b/u,
    );
  });

  it("has an explicit empty cutover with no historical reconstruction", () => {
    expect(migrationSql).toContain("Empty cutover by design");
    expect(migrationSql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/u);
  });
});
