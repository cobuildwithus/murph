import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readHostedGroupUsageStatus: vi.fn(),
  readHostedPersonalAiUsageStatus: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-execution/usage-status", () => ({
  readHostedPersonalAiUsageStatus: mocks.readHostedPersonalAiUsageStatus,
}));

vi.mock("@/src/lib/hosted-groups/group-usage-funding", () => ({
  readHostedGroupUsageStatus: mocks.readHostedGroupUsageStatus,
}));

import { projectHostedAiUsageLimitNoticeForDelivery } from "@/src/lib/hosted-execution/usage-limit-notice-message";
import {
  HOSTED_SPONSORED_GROUP_PAUSE_MESSAGE,
  renderUserFacingMessage,
} from "@/src/lib/hosted-messages/user-facing-messages";

describe("projectHostedAiUsageLimitNoticeForDelivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks the room to fund the group while it is exhausted", async () => {
    const prisma = { kind: "prisma" } as never;
    mocks.readHostedGroupUsageStatus.mockResolvedValue({
      fundingNeeded: true,
      fundingUrl:
        "https://www.withmurph.ai/groups/fund/group_join_code_1234",
      sponsorshipStatus: "not_sponsored",
    });

    const projected = await projectHostedAiUsageLimitNoticeForDelivery({
      memberId: "member_group_runtime",
      message: "Murph usage is paused for this chat.",
      noticeCode: "thread_usage_limit_reached",
      prisma,
    });

    expect(projected.startsWith("Murph usage is paused for this chat.\n\n")).toBe(true);
    expect(projected.endsWith(
      "\nhttps://www.withmurph.ai/groups/fund/group_join_code_1234",
    )).toBe(true);
    expect(projected).toMatch(
      /anyone|anybody|any one|any of you|one of you|someone|somebody|whoever|whichever|which of you|one person/iu,
    );
    expect(mocks.readHostedPersonalAiUsageStatus).not.toHaveBeenCalled();
  });

  it("keeps the group funding ask deterministic without exposing a period", async () => {
    const message = "I'm out for the whole room until my time resets.";
    mocks.readHostedGroupUsageStatus.mockResolvedValue({
      fundingNeeded: true,
      fundingUrl:
        "https://www.withmurph.ai/groups/fund/group_join_code_1234",
      sponsorshipStatus: "not_sponsored",
    });

    const project = async () => projectHostedAiUsageLimitNoticeForDelivery({
      memberId: "member_group_runtime",
      message,
      noticeCode: "thread_usage_limit_reached",
      prisma: {} as never,
    });

    expect(await project()).toBe(await project());
  });

  it("gives an exhausted sponsored room a private contribution path", async () => {
    mocks.readHostedGroupUsageStatus.mockResolvedValue({
      fundingNeeded: true,
      fundingUrl:
        "https://www.withmurph.ai/groups/fund/group_join_code_1234",
      sponsorshipStatus: "sponsored",
    });
    const productionNotice = renderUserFacingMessage({
      context: {},
      key: "linq.ai_usage.thread_limit_reached",
      seed: "member_group_runtime",
    }).text;

    const projected = await projectHostedAiUsageLimitNoticeForDelivery({
      memberId: "member_group_runtime",
      message: productionNotice,
      noticeCode: "thread_usage_limit_reached",
      prisma: {} as never,
    });

    expect(projected).toBe(
      `${HOSTED_SPONSORED_GROUP_PAUSE_MESSAGE}\n\n`
      + "More Murph time can be added privately here:\n"
      + "https://www.withmurph.ai/groups/fund/group_join_code_1234",
    );
    expect(projected).not.toBe(productionNotice);
    expect(projected).not.toMatch(
      /anyone|anybody|any one|any of you|one of you|someone|somebody|whoever|whichever|which of you|one person|tap|volunteer|cave|payer|\$|percent|remaining|balance|cap|refill|reset|month|back/iu,
    );
  });

  it("keeps a sponsored pause neutral without current urgency", async () => {
    mocks.readHostedGroupUsageStatus.mockResolvedValue({
      fundingNeeded: false,
      fundingUrl: null,
      sponsorshipStatus: "sponsored",
    });

    await expect(projectHostedAiUsageLimitNoticeForDelivery({
      memberId: "member_group_runtime",
      message: "I'm out for the whole room until my time resets.",
      noticeCode: "thread_usage_limit_reached",
      prisma: {} as never,
    })).resolves.toBe(HOSTED_SPONSORED_GROUP_PAUSE_MESSAGE);
  });

  it.each([
    [
      "https://checkout.stripe.test/session",
      HOSTED_SPONSORED_GROUP_PAUSE_MESSAGE,
    ],
    [
      "https://[invalid",
      HOSTED_SPONSORED_GROUP_PAUSE_MESSAGE,
    ],
  ])("rejects a non-canonical sponsored group funding URL: %s", async (
    fundingUrl,
    expected,
  ) => {
    mocks.readHostedGroupUsageStatus.mockResolvedValue({
      fundingNeeded: true,
      fundingUrl,
      sponsorshipStatus: "sponsored",
    });

    await expect(projectHostedAiUsageLimitNoticeForDelivery({
      memberId: "member_group_runtime",
      message: "I'm out for the whole room until my time resets.",
      noticeCode: "thread_usage_limit_reached",
      prisma: {} as never,
    })).resolves.toBe(expected);
  });

  it("leaves a stale group notice unchanged after capacity recovers", async () => {
    mocks.readHostedGroupUsageStatus.mockResolvedValue({
      fundingNeeded: false,
      fundingUrl: null,
      sponsorshipStatus: "not_sponsored",
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
