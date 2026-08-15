import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

type PrivateStorageClassification =
  | {
      kind: "approved-operational-metadata";
      rationale: string;
    }
  | {
      kind: "encrypted-content";
      rationale: string;
    }
  | {
      kind: "legacy-debt";
      owner: string;
      removalCondition: string;
    };

const HOSTED_PHONE_CALL_FIELD_CLASSIFICATION = {
  analyzedAt: operational("Provider-analysis lifecycle timestamp; contains no call content."),
  briefEncrypted: encrypted("Member-private bounded call brief."),
  briefJson: legacyDebt(),
  createdAt: operational("Row lifecycle timestamp; contains no call content."),
  endedAt: operational("Provider-call lifecycle timestamp; contains no call content."),
  id: operational("Opaque Murph row identity used for authority and AAD."),
  memberId: operational("Opaque member ownership key used for authority and AAD."),
  originSessionId: operational("Opaque initiating resident-session identity used for exact result binding."),
  provider: operational("Bounded provider discriminator."),
  providerCallId: operational("Opaque provider correlation identity."),
  requestKey: operational("Opaque idempotency identity."),
  resultEncrypted: encrypted("Member-private bounded final call analysis."),
  resultJson: legacyDebt(),
  resultNotificationChannel: operational(
    "Bounded initiating direct-channel discriminator used to route asynchronous results.",
  ),
  status: operational("Bounded call lifecycle enum."),
  updatedAt: operational("Row concurrency timestamp; contains no call content."),
} satisfies Record<string, PrivateStorageClassification>;

describe("HostedPhoneCall private-storage classification", () => {
  it("classifies every scalar field and rejects unreviewed schema growth", () => {
    const schema = readFileSync(
      new URL("../prisma/schema.prisma", import.meta.url),
      "utf8",
    );
    const fields = readHostedPhoneCallScalarFields(schema);

    expect(Object.keys(HOSTED_PHONE_CALL_FIELD_CLASSIFICATION).sort()).toEqual(
      fields.sort(),
    );
  });

  it("limits plaintext debt to the two legacy JSON columns with an owner and removal proof", () => {
    const debt = Object.entries(HOSTED_PHONE_CALL_FIELD_CLASSIFICATION)
      .filter(([, classification]) => classification.kind === "legacy-debt");

    expect(debt.map(([field]) => field).sort()).toEqual(["briefJson", "resultJson"]);
    for (const [, classification] of debt) {
      expect(classification).toMatchObject({
        kind: "legacy-debt",
        owner: "apps/web phone-call private-content migration",
        removalCondition: expect.stringContaining("zero remaining legacy values"),
      });
    }
  });

  it("keeps the expand migration additive and the old columns available for fallback", () => {
    const migration = readFileSync(
      new URL(
        "../prisma/migrations/20260710190000_hosted_phone_call_private_content/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain("ADD COLUMN \"brief_encrypted\" TEXT");
    expect(migration).toContain("ADD COLUMN \"result_encrypted\" TEXT");
    expect(migration).toContain("ALTER COLUMN \"brief_json\" DROP NOT NULL");
    expect(migration).not.toMatch(/DROP COLUMN/iu);
    expect(migration).not.toMatch(/SET NOT NULL/iu);
  });

  it("adds only a nullable bounded result-routing discriminator", () => {
    const migration = readFileSync(
      new URL(
        "../prisma/migrations/20260815120000_hosted_phone_call_result_notification_channel/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain(
      'CREATE TYPE "HostedPhoneCallResultNotificationChannel"',
    );
    expect(migration).toContain("AS ENUM ('linq', 'telegram')");
    expect(migration).toContain(
      'ADD COLUMN "result_notification_channel"',
    );
    expect(migration).not.toMatch(/DROP (?:COLUMN|TABLE|TYPE)/iu);
    expect(migration).not.toMatch(/SET NOT NULL/iu);
  });
});

function operational(rationale: string): PrivateStorageClassification {
  return { kind: "approved-operational-metadata", rationale };
}

function encrypted(rationale: string): PrivateStorageClassification {
  return { kind: "encrypted-content", rationale };
}

function legacyDebt(): PrivateStorageClassification {
  return {
    kind: "legacy-debt",
    owner: "apps/web phone-call private-content migration",
    removalCondition:
      "Remove only after production backfill reports zero remaining legacy values and prior web functions have drained.",
  };
}

function readHostedPhoneCallScalarFields(schema: string): string[] {
  const model = schema.match(/model HostedPhoneCall \{([\s\S]*?)\n\}/u)?.[1];
  if (!model) {
    throw new Error("Expected HostedPhoneCall Prisma model.");
  }

  return model
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//") && !line.startsWith("@@"))
    .filter((line) => !line.includes("@relation"))
    .map((line) => line.split(/\s+/u))
    .map(([field]) => field)
    .filter((field): field is string => Boolean(field));
}
