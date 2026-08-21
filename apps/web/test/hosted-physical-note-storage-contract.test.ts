import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const APPROVED_FIELDS = [
  "acceptedAt",
  "complimentaryOfferCode",
  "createdAt",
  "failureReason",
  "id",
  "memberId",
  "pricingVersion",
  "provider",
  "providerCostUsdMicros",
  "providerLetterId",
  "requestFingerprint",
  "requestKey",
  "status",
  "updatedAt",
].sort();

const APPROVED_RECOVERY_FIELDS = [
  "createdAt",
  "memberId",
  "originAssistantInputId",
  "physicalNoteId",
  "remainingUnresolved",
  "resultStatus",
  "retryAfter",
  "settledUsageCostUsdMicros",
  "updatedAt",
].sort();

describe("HostedPhysicalNote storage contract", () => {
  it("stores only bounded operational facts, never the address or artwork", () => {
    const schema = readFileSync(
      new URL("../prisma/schema.prisma", import.meta.url),
      "utf8",
    );
    const fields = readModelScalarFields(schema, "HostedPhysicalNote");

    expect(fields.sort()).toEqual(APPROVED_FIELDS);
    const body = schema.match(/model HostedPhysicalNote \{([\s\S]*?)\n\}/u)?.[1] ?? "";
    expect(body).not.toMatch(/address|recipient|artwork|image_url|file_url/iu);
  });

  it("enforces one promotional claim and one request identity per beneficiary", () => {
    const migration = readFileSync(
      new URL(
        "../prisma/migrations/20260730190000_hosted_physical_notes/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain(
      'ON "hosted_physical_note"("member_id", "complimentary_offer_code")',
    );
    expect(migration).toContain(
      'ON "hosted_physical_note"("member_id", "request_key")',
    );
    expect(migration).toContain("ON DELETE CASCADE");
  });

  it("stores only the bounded safe rejection category", () => {
    const migration = readFileSync(
      new URL(
        "../prisma/migrations/20260811170000_hosted_physical_note_failure_reason/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain(
      'ADD COLUMN "failure_reason" "HostedPhysicalNoteFailureReason"',
    );
    expect(migration).toContain("'recipient_address'");
    expect(migration).toContain("'artwork'");
    expect(migration).toContain("'service_unavailable'");
    expect(migration).toContain("'request_invalid'");
    expect(migration).toContain("'prior_note_unresolved'");
    expect(migration).toContain("'prior_note_accepted'");
    expect(migration).toContain("'unknown'");
    expect(migration).toContain(
      'CREATE INDEX CONCURRENTLY "hosted_physical_note_member_id_status_failure_reason_created_at_idx"',
    );
    expect(migration).toContain(
      'ON "hosted_physical_note"("member_id", "status", "failure_reason", "created_at")',
    );
    expect(migration).not.toMatch(/message|address_line|artwork_url/iu);
  });

  it("stores only a replay-stable recovery binding and bounded result", () => {
    const schema = readFileSync(
      new URL("../prisma/schema.prisma", import.meta.url),
      "utf8",
    );
    expect(readModelScalarFields(schema, "HostedPhysicalNoteRecovery").sort())
      .toEqual(APPROVED_RECOVERY_FIELDS);
    const body = schema.match(
      /model HostedPhysicalNoteRecovery \{([\s\S]*?)\n\}/u,
    )?.[1] ?? "";
    expect(body).not.toMatch(
      /address|recipient|artwork|image_url|file_url|message|note_text/iu,
    );

    const migration = readFileSync(
      new URL(
        "../prisma/migrations/20260820170000_hosted_physical_note_recovery/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(migration).toContain(
      'PRIMARY KEY ("origin_assistant_input_id")',
    );
    expect(migration).toContain(
      '"result_status" IN (\'accepted\', \'clear\', \'pending\', \'unavailable\')',
    );
    expect(migration).toContain('"settled_usage_cost_usd_micros" BIGINT');
    expect(migration).toContain('"settled_usage_cost_usd_micros" >= 0');
    expect(migration).toContain("ON DELETE SET NULL");
    expect(migration).not.toMatch(
      /address|recipient|artwork|image_url|file_url|message|note_text/iu,
    );
  });

  it("pins compatible Web as the no-send authority rollback floor", () => {
    const productContract = readFileSync(
      new URL(
        "../../../agent-docs/product-specs/physical-notes.md",
        import.meta.url,
      ),
      "utf8",
    );

    expect(productContract).toMatch(
      /Web artifact is a hard rollback\s+floor/iu,
    );
    expect(productContract).toMatch(
      /never roll Web below the floor while physical-note sending remains enabled/iu,
    );
    expect(productContract).toMatch(
      /disable\s+`HOSTED_PHYSICAL_NOTES_ENABLED`[\s\S]*drain every runner[\s\S]*keep the capability off until compatible Web and runner/iu,
    );
  });
});

function readModelScalarFields(schema: string, modelName: string): string[] {
  const body = schema.match(
    new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`, "u"),
  )?.[1];
  if (!body) throw new Error(`Expected ${modelName} Prisma model.`);

  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("@@"))
    .filter((line) => !line.includes("@relation"))
    .map((line) => line.split(/\s+/u)[0])
    .filter((field): field is string => Boolean(field));
}
