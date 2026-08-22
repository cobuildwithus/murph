import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("hosted-member verified-email boundary", () => {
  it("keeps verified-email persistence on the dedicated authorization owner table", () => {
    const schema = readFileSync(
      new URL("../prisma/schema.prisma", import.meta.url),
      "utf8",
    );

    for (const modelName of [
      "HostedMember",
      "HostedMemberIdentity",
      "HostedMemberRouting",
      "HostedMemberBillingRef",
    ]) {
      expect(readPrismaScalarFieldLines(schema, modelName).join("\n")).not.toMatch(/\bemail\w*\b/iu);
    }

    expect(readPrismaModelBlock(schema, "HostedMemberEmailAuthorization")).toMatch(
      /\bverifiedEmailAddressEncrypted\b/u,
    );
  });
});

function readPrismaModelBlock(schema: string, modelName: string): string {
  const match = schema.match(new RegExp(String.raw`model\s+${modelName}\s+\{[\s\S]*?\n\}`, "u"));

  if (!match) {
    throw new Error(`Expected Prisma model ${modelName} to exist.`);
  }

  return match[0];
}

function readPrismaScalarFieldLines(schema: string, modelName: string): string[] {
  return readPrismaModelBlock(schema, modelName)
    .split("\n")
    .slice(1, -1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//") && !line.startsWith("@@"))
    .filter((line) => {
      const match = line.match(/^(\w+)\s+([A-Za-z][A-Za-z0-9_\[\]?]*)\b/u);

      if (!match) {
        return false;
      }

      const type = match[2].replace(/\?$/u, "");
      return !match[2].endsWith("[]") && !HOSTED_MEMBER_RELATION_TYPES.has(type);
    });
}

const HOSTED_MEMBER_RELATION_TYPES = new Set([
  "HostedAiUsage",
  "HostedInvite",
  "HostedLinqDailyState",
  "HostedMember",
  "HostedMemberBillingRef",
  "HostedMemberEmailAuthorization",
  "HostedEmailPublicBootstrapAttempt",
  "HostedMemberIdentity",
  "HostedMemberRouting",
]);
