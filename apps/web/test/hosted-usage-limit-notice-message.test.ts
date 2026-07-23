import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readHostedGroupUsageStatusEnsuringFundingUrl: vi.fn(),
  readHostedPersonalAiUsageStatus: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-execution/usage-status", () => ({
  readHostedPersonalAiUsageStatus: mocks.readHostedPersonalAiUsageStatus,
}));

vi.mock("@/src/lib/hosted-groups/group-usage-funding", () => ({
  readHostedGroupUsageStatusEnsuringFundingUrl: mocks.readHostedGroupUsageStatusEnsuringFundingUrl,
}));

import { projectHostedAiUsageLimitNoticeForDelivery } from "@/src/lib/hosted-execution/usage-limit-notice-message";

describe("projectHostedAiUsageLimitNoticeForDelivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("appends a first-party group funding link while the group is exhausted", async () => {
    const prisma = { kind: "prisma" } as never;
    mocks.readHostedGroupUsageStatusEnsuringFundingUrl.mockResolvedValue({
      capacityState: "exhausted",
      fundingUrl:
        "https://www.withmurph.ai/groups/fund/group_join_code_1234",
      periodEnd: "2026-08-01T00:00:00.000Z",
    });

    await expect(projectHostedAiUsageLimitNoticeForDelivery({
      memberId: "member_group_runtime",
      message: "Murph usage is paused for this chat.",
      noticeCode: "thread_usage_limit_reached",
      prisma,
    })).resolves.toBe(
      "Murph usage is paused for this chat.\n\n" +
      "Add group usage: " +
      "https://www.withmurph.ai/groups/fund/group_join_code_1234",
    );
    expect(mocks.readHostedPersonalAiUsageStatus).not.toHaveBeenCalled();
  });

  it("leaves a stale group notice unchanged after capacity recovers", async () => {
    mocks.readHostedGroupUsageStatusEnsuringFundingUrl.mockResolvedValue({
      capacityState: "healthy",
      fundingUrl:
        "https://www.withmurph.ai/groups/fund/group_join_code_1234",
      periodEnd: "2026-08-01T00:00:00.000Z",
    });

    await expect(projectHostedAiUsageLimitNoticeForDelivery({
      memberId: "member_group_runtime",
      message: "Murph usage is paused for this chat.",
      noticeCode: "thread_usage_limit_reached",
      prisma: {} as never,
    })).resolves.toBe("Murph usage is paused for this chat.");
    expect(mocks.readHostedPersonalAiUsageStatus).not.toHaveBeenCalled();
  });

  it("appends the canonical first-party action only for current add-usage authority", async () => {
    mocks.readHostedPersonalAiUsageStatus.mockResolvedValue({
      recommendedAction: {
        kind: "add_usage",
        label: "Add usage",
        url: "/settings?addUsage=true#subscription",
      },
    });
    const prisma = { kind: "prisma" } as never;

    await expect(projectHostedAiUsageLimitNoticeForDelivery({
      memberId: "member_delivery",
      message: "Murph is paused for this usage period.",
      prisma,
    })).resolves.toBe(
      "Murph is paused for this usage period.\n\n" +
      "Add usage: https://www.withmurph.ai/settings?addUsage=true#subscription",
    );
    expect(mocks.readHostedPersonalAiUsageStatus).toHaveBeenCalledWith({
      memberId: "member_delivery",
      prisma,
    });
  });

  it("leaves neutral copy unchanged without a current add-usage action", async () => {
    mocks.readHostedPersonalAiUsageStatus.mockResolvedValue({
      recommendedAction: null,
    });

    await expect(projectHostedAiUsageLimitNoticeForDelivery({
      memberId: "member_ineligible",
      message: "Neutral usage notice.",
      prisma: {} as never,
    })).resolves.toBe("Neutral usage notice.");
  });

  it.each([
    "https://checkout.stripe.test/session",
    "https://[invalid",
  ])("rejects a non-canonical action URL: %s", async (url) => {
    mocks.readHostedPersonalAiUsageStatus.mockResolvedValue({
      recommendedAction: {
        kind: "add_usage",
        label: "Add usage",
        url,
      },
    });

    await expect(projectHostedAiUsageLimitNoticeForDelivery({
      memberId: "member_invalid_action_url",
      message: "Neutral usage notice.",
      prisma: {} as never,
    })).resolves.toBe("Neutral usage notice.");
  });

  it("fails to neutral copy when the delivery-time projection cannot be read", async () => {
    mocks.readHostedPersonalAiUsageStatus.mockRejectedValue(
      new Error("private projection failure"),
    );

    await expect(projectHostedAiUsageLimitNoticeForDelivery({
      memberId: "member_projection_failure",
      message: "Neutral usage notice.",
      prisma: {} as never,
    })).resolves.toBe("Neutral usage notice.");
  });
});
