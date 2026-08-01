import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const APPROVED_FIELDS = [
  "acceptedAt",
  "complimentaryOfferCode",
  "createdAt",
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
