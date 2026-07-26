import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  readHostedGroupUsageStatusForTest,
  seedHostedAiUsageLimitPeriodForTest,
  type HostedGroupUsageStatusForTest,
} from "#hosted-web-testing";

describe("hosted web testing helper boundary", () => {
  it("does not statically import the generated Prisma client", async () => {
    const source = await readFile(
      new URL("../../web/test/support/hosted-web-testkit.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(
      /from\s+["']@prisma\/client["']/,
    );
    expect(source).not.toMatch(
      /import\s+(?!type\s)(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+["'][^"']*src\/lib\/prisma(?:\.ts)?["']/,
    );
  });

  it("exposes narrow typed image-admission usage helpers", () => {
    const seedInput: Parameters<
      typeof seedHostedAiUsageLimitPeriodForTest
    >[0] = {
      limitUsdMicros: 50_000n,
      memberId: "member_group_runtime",
      periodEnd: new Date("2026-08-01T00:00:00.000Z"),
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      remainingUsdMicros: 49_000n,
    };
    const projected: HostedGroupUsageStatusForTest = {
      capacityState: "low",
      fundingUrl: "https://www.withmurph.ai/groups/fund/example",
      periodEnd: "2026-08-01T00:00:00.000Z",
      remainingPercent: 1,
    };

    expect(seedInput.limitUsdMicros).toBe(50_000n);
    expect(projected.capacityState).toBe("low");
    expect(typeof seedHostedAiUsageLimitPeriodForTest).toBe("function");
    expect(typeof readHostedGroupUsageStatusForTest).toBe("function");
  });
});
