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
    };

const HOSTED_PHONE_CALL_FIELD_CLASSIFICATION = {
  analyzedAt: operational("Provider-analysis lifecycle timestamp; contains no call content."),
  briefEncrypted: encrypted("Member-private bounded call brief."),
  createdAt: operational("Row lifecycle timestamp; contains no call content."),
  endedAt: operational("Provider-call lifecycle timestamp; contains no call content."),
  id: operational("Opaque Murph row identity used for authority and AAD."),
  memberId: operational("Opaque member ownership key used for authority and AAD."),
  originSessionId: operational("Opaque initiating resident-session identity used for exact result binding."),
  provider: operational("Bounded provider discriminator."),
  providerCallId: operational("Opaque provider correlation identity."),
  requestKey: operational("Opaque idempotency identity."),
  resultDeliveryGeneration: operational(
    "Monotonic bounded delivery-attempt generation; contains no message content.",
  ),
  resultDeliveryStatus: operational(
    "Fixed-vocabulary asynchronous result delivery disposition.",
  ),
  resultDeliveryTerminalAt: operational(
    "Result delivery lifecycle timestamp; contains no message content.",
  ),
  resultEncrypted: encrypted("Member-private bounded final call analysis."),
  resultNotificationChannel: operational(
    "Bounded initiating direct-channel discriminator used to route asynchronous results.",
  ),
  status: operational("Bounded call lifecycle enum."),
  stopRequestedAt: operational("Member stop-intent lifecycle timestamp; contains no call content."),
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

  it("keeps the historical expand migration additive", () => {
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

  it("adds only bounded result-routing ownership metadata", () => {
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
      'CREATE TYPE "HostedPhoneCallResultDeliveryStatus"',
    );
    expect(migration).toContain(
      'ADD COLUMN "result_notification_channel"',
    );
    expect(migration).toContain(
      'ADD COLUMN "result_delivery_status"',
    );
    expect(migration).toContain(
      'ADD COLUMN "result_delivery_generation" INTEGER DEFAULT 0',
    );
    expect(migration).not.toMatch(
      /ADD COLUMN "result_delivery_generation" INTEGER NOT NULL/u,
    );
    expect(migration).toContain(
      'ADD COLUMN "result_delivery_terminal_at" TIMESTAMP(3)',
    );
    expect(migration).toContain(
      'CREATE INDEX "hosted_phone_call_result_delivery_idx"',
    );
    expect(migration).not.toMatch(/DROP (?:COLUMN|TABLE|TYPE)/iu);
  });
});

function operational(rationale: string): PrivateStorageClassification {
  return { kind: "approved-operational-metadata", rationale };
}

function encrypted(rationale: string): PrivateStorageClassification {
  return { kind: "encrypted-content", rationale };
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
