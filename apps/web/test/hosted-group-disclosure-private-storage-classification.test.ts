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

const HOSTED_GROUP_DISCLOSURE_PERMISSION_FIELD_CLASSIFICATION = {
  groupId: operational("Opaque owning group key used for authority."),
  id: operational("Opaque permission identity used for replay and secure-box AAD."),
  messageLookupKey: operational("Server-keyed provider-message blind index."),
  permissionDigest: operational(
    "Group-scoped, server-keyed, versioned blind index used for immutable permission authority without exposing a plaintext dictionary or cross-group equality oracle.",
  ),
  permissionTextEncrypted: encrypted(
    "Exact group-visible natural-language permission encrypted under the synthetic group runtime.",
  ),
  postedAt: operational("Permission-message lifecycle timestamp."),
} satisfies Record<string, PrivateStorageClassification>;

describe("HostedGroupDisclosurePermission private-storage classification", () => {
  it("classifies every scalar field and rejects unreviewed schema growth", () => {
    const schema = readFileSync(
      new URL("../prisma/schema.prisma", import.meta.url),
      "utf8",
    );

    expect(
      Object.keys(HOSTED_GROUP_DISCLOSURE_PERMISSION_FIELD_CLASSIFICATION).sort(),
    ).toEqual(readHostedGroupDisclosurePermissionScalarFields(schema).sort());
  });

  it("persists the exact permission only in its encrypted column", () => {
    const migration = readFileSync(
      new URL(
        "../prisma/migrations/20260716120000_hosted_group_disclosure_permission/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain('"permission_text_encrypted" TEXT NOT NULL');
    expect(migration).not.toContain('"permission_text" TEXT');
  });
});

function operational(rationale: string): PrivateStorageClassification {
  return { kind: "approved-operational-metadata", rationale };
}

function encrypted(rationale: string): PrivateStorageClassification {
  return { kind: "encrypted-content", rationale };
}

function readHostedGroupDisclosurePermissionScalarFields(schema: string): string[] {
  const model = schema.match(
    /model HostedGroupDisclosurePermission \{([\s\S]*?)\n\}/u,
  )?.[1];
  if (!model) {
    throw new Error("Expected HostedGroupDisclosurePermission Prisma model.");
  }

  return model
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("@@"))
    .filter((line) => !line.includes("@relation") && !line.includes("[]"))
    .map((line) => line.split(/\s+/u)[0])
    .filter((field): field is string => Boolean(field));
}
