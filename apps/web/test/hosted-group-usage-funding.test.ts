import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasHostedRuntimeActiveAccess: vi.fn(),
  readHostedAiUsageGate: vi.fn(),
  resolveHostedPublicBaseUrl: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  readHostedAiUsageGate: mocks.readHostedAiUsageGate,
}));

vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({
  hasHostedRuntimeActiveAccess: mocks.hasHostedRuntimeActiveAccess,
}));

vi.mock("@/src/lib/hosted-web/public-url", () => ({
  resolveHostedPublicBaseUrl: mocks.resolveHostedPublicBaseUrl,
}));

import {
  calculateHostedGroupUsageRemainingPercent,
} from "@/src/lib/hosted-groups/group-usage-capacity";
import {
  readHostedGroupUsageFundingTargetByJoinCode,
  readHostedGroupUsageStatus,
} from "@/src/lib/hosted-groups/group-usage-funding";

describe("hosted group usage funding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(true);
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

  it.each([
    [3_000_000n, "healthy", 66],
    [900_000n, "low", 20],
    [1n, "low", 0],
    [0n, "exhausted", 0],
    [9_000_000n, "healthy", 100],
  ] as const)("projects %s remaining as %s without exposing accounting", async (
    remainingUsdMicros,
    capacityState,
    remainingPercent,
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

    await expect(readHostedGroupUsageStatus({
      prisma: prisma as never,
      runtimeMemberId: "member_group_runtime",
    })).resolves.toEqual({
      capacityState,
      fundingUrl:
        "https://www.withmurph.ai/groups/fund/group_join_code_1234",
      periodEnd: "2026-08-01T00:00:00.000Z",
      remainingPercent,
    });
  });

  it.each([0n, -1n])(
    "reports zero percent when the period limit %s is not a valid denominator",
    (limitUsdMicros) => {
      expect(calculateHostedGroupUsageRemainingPercent({
        limitUsdMicros,
        remainingUsdMicros: 1_000_000n,
      })).toBe(0);
    },
  );

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
