import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("hosted-member verified-email boundary", () => {
  it("keeps email identity out of the hosted-member Prisma models", () => {
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
      expect(readPrismaModelBlock(schema, modelName)).not.toMatch(/\bemail\w*\b/iu);
    }
  });
});

function readPrismaModelBlock(schema: string, modelName: string): string {
  const match = schema.match(new RegExp(String.raw`model\s+${modelName}\s+\{[\s\S]*?\n\}`, "u"));

  if (!match) {
    throw new Error(`Expected Prisma model ${modelName} to exist.`);
  }

  return match[0];
}
