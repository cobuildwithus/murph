import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureHostedGroupUsageFundingJoinLinkTx: vi.fn(),
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

vi.mock("@/src/lib/hosted-groups/group-store", () => ({
  ensureHostedGroupUsageFundingJoinLinkTx:
    mocks.ensureHostedGroupUsageFundingJoinLinkTx,
}));

import {
  readHostedGroupUsageFundingTargetByJoinCode,
  readHostedGroupUsageStatus,
  readHostedGroupUsageStatusEnsuringFundingUrl,
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
    [3_000_000n, "healthy"],
    [900_000n, "low"],
    [0n, "exhausted"],
  ] as const)("projects %s remaining as %s without exposing accounting", async (
    remainingUsdMicros,
    capacityState,
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
    });
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

  it("provisions the group shell and join link for a chat that never minted one", async () => {
    const state = { group: null as { joinCode: string | null } | null };
    const prisma = {
      $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run({ tx: true })),
      hostedGroup: {
        findUnique: vi.fn(async () => state.group),
      },
      hostedThreadContainer: {
        findUnique: vi.fn(async (args: { select?: { ownerMemberId?: boolean } }) => (
          args.select?.ownerMemberId
            ? { ownerMemberId: "member_owner_1" }
            : { memberId: "member_group_runtime" }
        )),
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
    mocks.ensureHostedGroupUsageFundingJoinLinkTx.mockImplementation(
      async () => {
        state.group = { joinCode: "minted_join_code_1234" };
        return { group: { id: "hgrp_1" }, joinCode: "minted_join_code_1234" };
      },
    );

    await expect(readHostedGroupUsageStatusEnsuringFundingUrl({
      prisma: prisma as never,
      runtimeMemberId: "member_group_runtime",
    })).resolves.toEqual({
      capacityState: "exhausted",
      fundingUrl: "https://www.withmurph.ai/groups/fund/minted_join_code_1234",
      periodEnd: "2026-08-01T00:00:00.000Z",
    });
    expect(mocks.ensureHostedGroupUsageFundingJoinLinkTx)
      .toHaveBeenCalledWith(expect.objectContaining({
        containerMemberId: "member_group_runtime",
      }));
  });

  it("does not provision for a retained container whose runtime access is inactive", async () => {
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(false);
    const prisma = {
      $transaction: vi.fn(),
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

    await expect(readHostedGroupUsageStatusEnsuringFundingUrl({
      prisma: prisma as never,
      runtimeMemberId: "member_group_runtime",
    })).resolves.toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.ensureHostedGroupUsageFundingJoinLinkTx).not.toHaveBeenCalled();
  });

  it("mints a join link for an existing group row without one", async () => {
    const state = { group: { joinCode: null as string | null } };
    const prisma = {
      $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run({ tx: true })),
      hostedGroup: {
        findUnique: vi.fn(async () => state.group),
      },
      hostedThreadContainer: {
        findUnique: vi.fn(async (args: { select?: { ownerMemberId?: boolean } }) => (
          args.select?.ownerMemberId
            ? { ownerMemberId: "member_owner_1" }
            : { memberId: "member_group_runtime" }
        )),
      },
    };
    mocks.readHostedAiUsageGate.mockResolvedValue({
      allowanceSource: "thread_container",
      allowed: true,
      limitUsdMicros: 4_500_000n,
      periodEnd: new Date("2026-08-01T00:00:00.000Z"),
      remainingUsdMicros: 900_000n,
    });
    mocks.ensureHostedGroupUsageFundingJoinLinkTx.mockImplementation(
      async () => {
        state.group = { joinCode: "minted_join_code_5678" };
        return { group: { id: "hgrp_1" }, joinCode: "minted_join_code_5678" };
      },
    );

    await expect(readHostedGroupUsageStatusEnsuringFundingUrl({
      prisma: prisma as never,
      runtimeMemberId: "member_group_runtime",
    })).resolves.toEqual({
      capacityState: "low",
      fundingUrl: "https://www.withmurph.ai/groups/fund/minted_join_code_5678",
      periodEnd: "2026-08-01T00:00:00.000Z",
    });
  });

  it("reuses an existing join link without provisioning", async () => {
    const prisma = {
      $transaction: vi.fn(),
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

    await expect(readHostedGroupUsageStatusEnsuringFundingUrl({
      prisma: prisma as never,
      runtimeMemberId: "member_group_runtime",
    })).resolves.toEqual({
      capacityState: "healthy",
      fundingUrl: "https://www.withmurph.ai/groups/fund/group_join_code_1234",
      periodEnd: "2026-08-01T00:00:00.000Z",
    });
    expect(mocks.ensureHostedGroupUsageFundingJoinLinkTx)
      .not.toHaveBeenCalled();
  });

  it("does not provision for a runtime that is not an active thread container", async () => {
    const prisma = {
      $transaction: vi.fn(),
      hostedGroup: {
        findUnique: vi.fn(async () => null),
      },
      hostedThreadContainer: {
        findUnique: vi.fn(async () => null),
      },
    };
    mocks.readHostedAiUsageGate.mockResolvedValue({
      allowanceSource: "member",
      allowed: true,
      limitUsdMicros: 4_500_000n,
      periodEnd: new Date("2026-08-01T00:00:00.000Z"),
      remainingUsdMicros: 3_000_000n,
    });

    await expect(readHostedGroupUsageStatusEnsuringFundingUrl({
      prisma: prisma as never,
      runtimeMemberId: "member_personal",
    })).resolves.toBeNull();
    expect(mocks.ensureHostedGroupUsageFundingJoinLinkTx)
      .not.toHaveBeenCalled();
  });

  it("keeps the linkless status when provisioning fails", async () => {
    const prisma = {
      $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run({ tx: true })),
      hostedGroup: {
        findUnique: vi.fn(async () => ({ joinCode: null })),
      },
      hostedThreadContainer: {
        findUnique: vi.fn(async (args: { select?: { ownerMemberId?: boolean } }) => (
          args.select?.ownerMemberId
            ? { ownerMemberId: "member_owner_1" }
            : { memberId: "member_group_runtime" }
        )),
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
    mocks.ensureHostedGroupUsageFundingJoinLinkTx.mockRejectedValue(
      new Error("provisioning failed"),
    );

    await expect(readHostedGroupUsageStatusEnsuringFundingUrl({
      prisma: prisma as never,
      runtimeMemberId: "member_group_runtime",
    })).resolves.toEqual({
      capacityState: "exhausted",
      fundingUrl: null,
      periodEnd: "2026-08-01T00:00:00.000Z",
    });
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
