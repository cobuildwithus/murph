import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasHostedGroupAutomaticRefillAvailable: vi.fn(),
  hasHostedRuntimeActiveAccess: vi.fn(),
  readHostedAiUsageGate: vi.fn(),
  readHostedGroupSponsorshipPublicState: vi.fn(),
  resolveHostedPublicBaseUrl: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  readHostedAiUsageGate: mocks.readHostedAiUsageGate,
}));

vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({
  hasHostedRuntimeActiveAccess: mocks.hasHostedRuntimeActiveAccess,
}));

vi.mock("@/src/lib/hosted-groups/group-sponsorship-authorization", () => ({
  hasHostedGroupAutomaticRefillAvailable:
    mocks.hasHostedGroupAutomaticRefillAvailable,
  readHostedGroupSponsorshipPublicState:
    mocks.readHostedGroupSponsorshipPublicState,
}));

vi.mock("@/src/lib/hosted-web/public-url", () => ({
  resolveHostedPublicBaseUrl: mocks.resolveHostedPublicBaseUrl,
}));

import {
  buildHostedGroupUsageFundingLocatorForRuntimeMember,
  buildHostedGroupUsageFundingUrl,
  normalizeHostedGroupUsageFundingLocator,
  normalizeHostedGroupUsageJoinCode,
  readHostedGroupFundingRecoveryStatus,
  readHostedGroupUsageFundingLocatorRuntimeMemberId,
  readHostedGroupUsageFundingTargetByJoinCode,
  readHostedGroupUsageFundingTargetByLocator,
  readHostedGroupUsageStatus,
} from "@/src/lib/hosted-groups/group-usage-funding";

const TEST_HMAC_KEY = Buffer.alloc(32, 7).toString("base64url");

describe("hosted group usage funding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HOSTED_APP_SESSION_HMAC_KEY = TEST_HMAC_KEY;
    mocks.hasHostedGroupAutomaticRefillAvailable.mockResolvedValue(false);
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(true);
    mocks.readHostedGroupSponsorshipPublicState.mockResolvedValue(
      "not_sponsored",
    );
    mocks.resolveHostedPublicBaseUrl.mockReturnValue("https://www.withmurph.ai");
  });

  it("uses the existing opaque join code for an active group target", async () => {
    const prisma = {
      hostedGroup: {
        findUnique: vi.fn(async () => ({
          displayName: "Sunday sleep crew",
          joinCode: "group_join_code_1234",
          kind: "friends",
          runtimeMemberId: "member_group_runtime",
        })),
      },
      hostedThreadContainer: {
        findUnique: vi.fn(async () => ({ memberId: "member_group_runtime" })),
      },
    };

    await expect(readHostedGroupUsageFundingTargetByJoinCode({
      joinCode: "group_join_code_1234",
      prisma: prisma as never,
    })).resolves.toEqual({
      displayName: "Sunday sleep crew",
      fundingPath: "/groups/fund/group_join_code_1234",
      joinCode: "group_join_code_1234",
      kind: "friends",
      runtimeMemberId: "member_group_runtime",
    });
    expect(mocks.hasHostedRuntimeActiveAccess).toHaveBeenCalledWith(
      "member_group_runtime",
      { prisma },
    );
  });

  it("keeps the funding page's private sponsor state in a separate projection", async () => {
    const prisma = { kind: "prisma" } as never;
    mocks.readHostedGroupSponsorshipPublicState.mockResolvedValue("sponsored");

    await expect(readHostedGroupUsageStatus({
      prisma,
      runtimeMemberId: "member_group_runtime",
    })).resolves.toEqual({ sponsorshipStatus: "sponsored" });
    expect(mocks.readHostedGroupSponsorshipPublicState).toHaveBeenCalledWith({
      beneficiaryMemberId: "member_group_runtime",
      prisma,
    });
    expect(mocks.readHostedAiUsageGate).not.toHaveBeenCalled();
    expect(mocks.hasHostedGroupAutomaticRefillAvailable).not.toHaveBeenCalled();
  });

  it.each([
    [3_000_000n, false],
    [900_000n, true],
    [1n, true],
    [0n, true],
    [9_000_000n, false],
  ] as const)("projects urgency independently for %s remaining", async (
    remainingUsdMicros,
    fundingNeeded,
  ) => {
    const prisma = {
      hostedGroup: {
        findUnique: vi.fn(async () => ({ joinCode: "group_join_code_1234" })),
      },
      hostedThreadContainer: {
        findUnique: vi.fn(async () => ({ memberId: "member_group_runtime" })),
      },
    };
    mocks.readHostedAiUsageGate.mockResolvedValue({
      allowanceSource: "thread_container",
      allowed: remainingUsdMicros > 0n,
      limitUsdMicros: 4_500_000n,
      periodEnd: new Date("2026-08-01T00:00:00.000Z"),
      reason: remainingUsdMicros > 0n ? undefined : "ai_usage_limit_exceeded",
      remainingUsdMicros,
    });

    await expect(readHostedGroupFundingRecoveryStatus({
      prisma: prisma as never,
      runtimeMemberId: "member_group_runtime",
    })).resolves.toEqual({
      fundingNeeded,
      fundingUrl:
        "https://www.withmurph.ai/groups/fund/group_join_code_1234",
    });
    expect(mocks.readHostedGroupSponsorshipPublicState).not.toHaveBeenCalled();
  });

  it("always projects urgency when the room is exhausted", async () => {
    const prisma = {
      hostedGroup: {
        findUnique: vi.fn(async () => ({ joinCode: "group_join_code_1234" })),
      },
      hostedThreadContainer: {
        findUnique: vi.fn(async () => ({ memberId: "member_group_runtime" })),
      },
    };
    mocks.readHostedAiUsageGate.mockResolvedValue({
      allowanceSource: "thread_container",
      allowed: false,
      limitUsdMicros: 4_500_000n,
      periodEnd: new Date("2026-08-01T00:00:00.000Z"),
      reason: "ai_usage_limit_exceeded",
      remainingUsdMicros: 0n,
    });
    mocks.hasHostedGroupAutomaticRefillAvailable.mockResolvedValue(true);
    await expect(readHostedGroupFundingRecoveryStatus({
      prisma: prisma as never,
      runtimeMemberId: "member_group_runtime",
    })).resolves.toEqual({
      fundingNeeded: true,
      fundingUrl:
        "https://www.withmurph.ai/groups/fund/group_join_code_1234",
    });
    expect(mocks.hasHostedGroupAutomaticRefillAvailable).not.toHaveBeenCalled();
    expect(mocks.readHostedGroupSponsorshipPublicState).not.toHaveBeenCalled();
  });

  it("does not create urgency for a healthy room", async () => {
    const prisma = {
      hostedGroup: {
        findUnique: vi.fn(async () => ({ joinCode: "group_join_code_1234" })),
      },
      hostedThreadContainer: {
        findUnique: vi.fn(async () => ({ memberId: "member_group_runtime" })),
      },
    };
    mocks.readHostedAiUsageGate.mockResolvedValue({
      allowanceSource: "thread_container",
      allowed: true,
      limitUsdMicros: 4_500_000n,
      periodEnd: new Date("2026-08-01T00:00:00.000Z"),
      remainingUsdMicros: 3_000_000n,
    });
    await expect(readHostedGroupFundingRecoveryStatus({
      prisma: prisma as never,
      runtimeMemberId: "member_group_runtime",
    })).resolves.toMatchObject({
      fundingNeeded: false,
    });
    expect(mocks.hasHostedGroupAutomaticRefillAvailable).not.toHaveBeenCalled();
  });

  it("suppresses low-capacity urgency while automatic recovery is available", async () => {
    const prisma = {
      hostedGroup: {
        findUnique: vi.fn(async () => ({ joinCode: "group_join_code_1234" })),
      },
      hostedThreadContainer: {
        findUnique: vi.fn(async () => ({ memberId: "member_group_runtime" })),
      },
    };
    mocks.readHostedAiUsageGate.mockResolvedValue({
      allowanceSource: "thread_container",
      allowed: true,
      limitUsdMicros: 4_500_000n,
      periodEnd: new Date("2026-08-01T00:00:00.000Z"),
      remainingUsdMicros: 900_000n,
    });
    mocks.hasHostedGroupAutomaticRefillAvailable.mockResolvedValue(true);
    await expect(readHostedGroupFundingRecoveryStatus({
      prisma: prisma as never,
      runtimeMemberId: "member_group_runtime",
    })).resolves.toMatchObject({
      fundingNeeded: false,
    });
    expect(mocks.hasHostedGroupAutomaticRefillAvailable).toHaveBeenCalledWith({
      beneficiaryMemberId: "member_group_runtime",
      prisma,
    });
  });

  it("projects low-capacity urgency when automatic recovery is unavailable", async () => {
    const prisma = {
      hostedGroup: {
        findUnique: vi.fn(async () => ({ joinCode: "group_join_code_1234" })),
      },
      hostedThreadContainer: {
        findUnique: vi.fn(async () => ({ memberId: "member_group_runtime" })),
      },
    };
    mocks.readHostedAiUsageGate.mockResolvedValue({
      allowanceSource: "thread_container",
      allowed: true,
      limitUsdMicros: 4_500_000n,
      periodEnd: new Date("2026-08-01T00:00:00.000Z"),
      remainingUsdMicros: 900_000n,
    });
    await expect(readHostedGroupFundingRecoveryStatus({
      prisma: prisma as never,
      runtimeMemberId: "member_group_runtime",
    })).resolves.toMatchObject({
      fundingNeeded: true,
    });
  });

  it("derives a signed funding-only locator URL for a chat with no group row", async () => {
    const prisma = {
      hostedGroup: {
        findUnique: vi.fn(async () => null),
      },
      hostedThreadContainer: {
        findUnique: vi.fn(async () => ({ memberId: "member_group_runtime" })),
      },
    };
    mocks.readHostedAiUsageGate.mockResolvedValue({
      allowanceSource: "thread_container",
      allowed: false,
      limitUsdMicros: 4_500_000n,
      periodEnd: new Date("2026-08-01T00:00:00.000Z"),
      reason: "ai_usage_limit_exceeded",
      remainingUsdMicros: 0n,
    });

    const status = await readHostedGroupFundingRecoveryStatus({
      prisma: prisma as never,
      runtimeMemberId: "member_group_runtime",
    });
    const expectedLocator =
      buildHostedGroupUsageFundingLocatorForRuntimeMember("member_group_runtime");

    expect(status).toEqual({
      fundingNeeded: true,
      fundingUrl: `https://www.withmurph.ai/groups/fund/${encodeURIComponent(expectedLocator ?? "")}`,
    });
    expect(expectedLocator).toMatch(/^gf1\.member_group_runtime\./u);
  });

  it("constructs and parses a signed funding URL on a configured hosted alias", () => {
    mocks.resolveHostedPublicBaseUrl.mockReturnValue(
      "https://join.example.test",
    );
    const locator =
      buildHostedGroupUsageFundingLocatorForRuntimeMember("member_group_runtime");

    expect(locator).not.toBeNull();
    expect(buildHostedGroupUsageFundingUrl({
      joinCode: locator ?? "",
    })).toBe(
      `https://join.example.test/groups/fund/${encodeURIComponent(locator ?? "")}`,
    );
    expect(readHostedGroupUsageFundingLocatorRuntimeMemberId(locator))
      .toBe("member_group_runtime");
  });

  it("derives the locator URL for a group row without a join code", async () => {
    const prisma = {
      hostedGroup: {
        findUnique: vi.fn(async () => ({ joinCode: null })),
      },
      hostedThreadContainer: {
        findUnique: vi.fn(async () => ({ memberId: "member_group_runtime" })),
      },
    };
    mocks.readHostedAiUsageGate.mockResolvedValue({
      allowanceSource: "thread_container",
      allowed: true,
      limitUsdMicros: 4_500_000n,
      periodEnd: new Date("2026-08-01T00:00:00.000Z"),
      remainingUsdMicros: 900_000n,
    });

    const status = await readHostedGroupFundingRecoveryStatus({
      prisma: prisma as never,
      runtimeMemberId: "member_group_runtime",
    });

    expect(status?.fundingNeeded).toBe(true);
    expect(status?.fundingUrl).toContain("/groups/fund/gf1.member_group_runtime.");
  });

  it("never lets the signed locator pass as a join code", () => {
    const locator =
      buildHostedGroupUsageFundingLocatorForRuntimeMember("member_group_runtime");

    expect(locator).not.toBeNull();
    expect(normalizeHostedGroupUsageJoinCode(locator)).toBeNull();
    expect(normalizeHostedGroupUsageFundingLocator(locator)).toBe(locator);
    expect(normalizeHostedGroupUsageFundingLocator("group_join_code_1234"))
      .toBe("group_join_code_1234");
  });

  it("rejects tampered, foreign, and malformed locators", () => {
    const locator =
      buildHostedGroupUsageFundingLocatorForRuntimeMember("member_group_runtime");
    const [prefix, memberId, signature] = (locator ?? "").split(".");

    expect(readHostedGroupUsageFundingLocatorRuntimeMemberId(locator))
      .toBe("member_group_runtime");
    expect(readHostedGroupUsageFundingLocatorRuntimeMemberId(
      `${prefix}.member_other_1.${signature}`,
    )).toBeNull();
    expect(readHostedGroupUsageFundingLocatorRuntimeMemberId(
      `${prefix}.${memberId}.${signature.slice(0, -2)}xx`,
    )).toBeNull();
    expect(readHostedGroupUsageFundingLocatorRuntimeMemberId(`${prefix}.${memberId}`))
      .toBeNull();
    expect(readHostedGroupUsageFundingLocatorRuntimeMemberId("group_join_code_1234"))
      .toBeNull();
    expect(readHostedGroupUsageFundingLocatorRuntimeMemberId(null)).toBeNull();
  });

  it("resolves a verified locator to its exact container without a group row", async () => {
    const locator =
      buildHostedGroupUsageFundingLocatorForRuntimeMember("member_group_runtime");
    const prisma = {
      hostedGroup: {
        findUnique: vi.fn(async () => null),
      },
      hostedThreadContainer: {
        findUnique: vi.fn(async () => ({ memberId: "member_group_runtime" })),
      },
    };

    await expect(readHostedGroupUsageFundingTargetByLocator({
      locator: locator ?? "",
      prisma: prisma as never,
    })).resolves.toEqual({
      displayName: null,
      fundingPath: `/groups/fund/${encodeURIComponent(locator ?? "")}`,
      joinCode: locator,
      kind: "custom",
      runtimeMemberId: "member_group_runtime",
    });
  });

  it("resolves a signed locator through the join-code entry the funding page uses", async () => {
    const locator =
      buildHostedGroupUsageFundingLocatorForRuntimeMember("member_group_runtime");
    const prisma = {
      hostedGroup: {
        findUnique: vi.fn(async () => null),
      },
      hostedThreadContainer: {
        findUnique: vi.fn(async () => ({ memberId: "member_group_runtime" })),
      },
    };

    await expect(readHostedGroupUsageFundingTargetByJoinCode({
      joinCode: locator ?? "",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      joinCode: locator,
      kind: "custom",
      runtimeMemberId: "member_group_runtime",
    });
  });

  it("keeps a signed funding locator private from an owner-created join code", async () => {
    const locator =
      buildHostedGroupUsageFundingLocatorForRuntimeMember("member_group_runtime");
    const group = {
      displayName: "Sunday sleep crew",
      joinCode: "group_join_code_1234",
      kind: "friends",
      runtimeMemberId: "member_group_runtime",
    };
    const prisma = {
      hostedGroup: {
        findUnique: vi.fn(async () => group),
      },
      hostedThreadContainer: {
        findUnique: vi.fn(async () => ({ memberId: "member_group_runtime" })),
      },
    };

    const signedTarget = await readHostedGroupUsageFundingTargetByJoinCode({
      joinCode: locator ?? "",
      prisma: prisma as never,
    });

    expect(signedTarget).toMatchObject({
      fundingPath: `/groups/fund/${encodeURIComponent(locator ?? "")}`,
      joinCode: locator,
      runtimeMemberId: "member_group_runtime",
    });
    expect(signedTarget).not.toEqual(expect.objectContaining({
      fundingPath: expect.stringContaining(group.joinCode),
      joinCode: group.joinCode,
    }));
    expect(prisma.hostedGroup.findUnique).toHaveBeenCalledWith({
      select: { displayName: true, kind: true },
      where: { runtimeMemberId: "member_group_runtime" },
    });
  });

  it("fails closed on a locator for a missing or inactive container", async () => {
    const locator =
      buildHostedGroupUsageFundingLocatorForRuntimeMember("member_group_runtime");

    await expect(readHostedGroupUsageFundingTargetByLocator({
      locator: locator ?? "",
      prisma: {
        hostedGroup: { findUnique: vi.fn(async () => null) },
        hostedThreadContainer: { findUnique: vi.fn(async () => null) },
      } as never,
    })).resolves.toBeNull();

    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(false);
    await expect(readHostedGroupUsageFundingTargetByLocator({
      locator: locator ?? "",
      prisma: {
        hostedGroup: { findUnique: vi.fn(async () => null) },
        hostedThreadContainer: {
          findUnique: vi.fn(async () => ({ memberId: "member_group_runtime" })),
        },
      } as never,
    })).resolves.toBeNull();
  });

  it("fails closed when the group runtime is not active", async () => {
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(false);
    const prisma = {
      hostedGroup: {
        findUnique: vi.fn(async () => ({
          displayName: null,
          joinCode: "group_join_code_1234",
          kind: "custom",
          runtimeMemberId: "member_group_runtime",
        })),
      },
      hostedThreadContainer: {
        findUnique: vi.fn(async () => ({ memberId: "member_group_runtime" })),
      },
    };

    await expect(readHostedGroupUsageFundingTargetByJoinCode({
      joinCode: "group_join_code_1234",
      prisma: prisma as never,
    })).resolves.toBeNull();
  });

  it("fails closed when the linked runtime member is not a thread container", async () => {
    const prisma = {
      hostedGroup: {
        findUnique: vi.fn(async () => ({
          displayName: null,
          joinCode: "group_join_code_1234",
          kind: "custom",
          runtimeMemberId: "member_personal",
        })),
      },
      hostedThreadContainer: {
        findUnique: vi.fn(async () => null),
      },
    };

    await expect(readHostedGroupUsageFundingTargetByJoinCode({
      joinCode: "group_join_code_1234",
      prisma: prisma as never,
    })).resolves.toBeNull();
  });
});
