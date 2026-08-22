import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildHostedGroupUsageFundingLocatorForRuntimeMember: vi.fn(),
  buildHostedGroupUsageFundingUrl: vi.fn(),
  resolveHostedPublicBaseUrl: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-groups/group-usage-funding", () => ({
  buildHostedGroupUsageFundingLocatorForRuntimeMember:
    mocks.buildHostedGroupUsageFundingLocatorForRuntimeMember,
  buildHostedGroupUsageFundingUrl: mocks.buildHostedGroupUsageFundingUrl,
}));

vi.mock("@/src/lib/hosted-web/public-url", () => ({
  resolveHostedPublicBaseUrl: mocks.resolveHostedPublicBaseUrl,
}));

import { projectHostedAiUsageLimitNoticeForDelivery } from "@/src/lib/hosted-execution/usage-limit-notice-message";

describe("projectHostedAiUsageLimitNoticeForDelivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildHostedGroupUsageFundingLocatorForRuntimeMember.mockReturnValue(
      "gf1.member_group_runtime.signature",
    );
    mocks.buildHostedGroupUsageFundingUrl.mockReturnValue(
      "https://www.withmurph.ai/groups/fund/group_join_code_1234",
    );
    mocks.resolveHostedPublicBaseUrl.mockReturnValue(
      "https://www.withmurph.ai",
    );
  });

  it("always gives an exhausted room a neutral private recovery link", async () => {
    const prisma = { kind: "prisma" } as never;

    const projected = await projectHostedAiUsageLimitNoticeForDelivery({
      memberId: "member_group_runtime",
      message: "Murph usage is paused for this chat.",
      noticeCode: "thread_usage_limit_reached",
      prisma,
    });

    expect(projected).toBe(
      "Murph is paused in this chat right now. "
      + "Private options to add more Murph time are here, or the room can wait "
      + "for its allowance to reset:\n"
      + "https://www.withmurph.ai/groups/fund/group_join_code_1234",
    );
    expect(projected).not.toMatch(/one tap|turn me back on|bring me back|volunteer/iu);
    expect(mocks.buildHostedGroupUsageFundingLocatorForRuntimeMember)
      .toHaveBeenCalledWith("member_group_runtime");
    expect(mocks.buildHostedGroupUsageFundingUrl).toHaveBeenCalledWith({
      joinCode: "gf1.member_group_runtime.signature",
      publicBaseUrl: "https://www.withmurph.ai",
    });
  });

  it("uses the configured first-party origin for an exhausted room", async () => {
    mocks.resolveHostedPublicBaseUrl.mockReturnValue(
      "https://join.example.test",
    );
    mocks.buildHostedGroupUsageFundingUrl.mockReturnValue(
      "https://join.example.test/groups/fund/group_join_code_1234",
    );

    await expect(projectHostedAiUsageLimitNoticeForDelivery({
      memberId: "member_group_runtime",
      message: "Murph usage is paused for this chat.",
      noticeCode: "thread_usage_limit_reached",
      prisma: {} as never,
    })).resolves.toContain(
      "https://join.example.test/groups/fund/group_join_code_1234",
    );
    expect(mocks.buildHostedGroupUsageFundingUrl).toHaveBeenCalledWith({
      joinCode: "gf1.member_group_runtime.signature",
      publicBaseUrl: "https://join.example.test",
    });
  });

  it.each([
    "https://checkout.stripe.test/session",
    "https://[invalid",
  ])("rejects a non-canonical group funding URL: %s", async (fundingUrl) => {
    mocks.buildHostedGroupUsageFundingUrl.mockReturnValue(fundingUrl);

    await expect(projectHostedAiUsageLimitNoticeForDelivery({
      memberId: "member_group_runtime",
      message: "I'm out for the whole room until my time resets.",
      noticeCode: "thread_usage_limit_reached",
      prisma: {} as never,
    })).rejects.toThrow();
  });

  it("refuses to produce linkless copy when the mandatory locator is unavailable", async () => {
    mocks.buildHostedGroupUsageFundingLocatorForRuntimeMember.mockReturnValue(null);

    await expect(projectHostedAiUsageLimitNoticeForDelivery({
      memberId: "member_group_runtime",
      message: "Murph usage is paused for this chat.",
      noticeCode: "thread_usage_limit_reached",
      prisma: {} as never,
    })).rejects.toThrow("Hosted group usage-limit recovery URL is unavailable.");
  });

  it("refuses to produce linkless copy without a trusted public origin", async () => {
    mocks.resolveHostedPublicBaseUrl.mockReturnValue(null);

    await expect(projectHostedAiUsageLimitNoticeForDelivery({
      memberId: "member_group_runtime",
      message: "Murph usage is paused for this chat.",
      noticeCode: "thread_usage_limit_reached",
      prisma: {} as never,
    })).rejects.toThrow("Hosted group usage-limit recovery URL is unavailable.");
    expect(mocks.buildHostedGroupUsageFundingLocatorForRuntimeMember)
      .not.toHaveBeenCalled();
    expect(mocks.buildHostedGroupUsageFundingUrl).not.toHaveBeenCalled();
  });

  it("refuses to produce linkless copy when the mandatory URL is unavailable", async () => {
    mocks.buildHostedGroupUsageFundingUrl.mockReturnValue(null);

    await expect(projectHostedAiUsageLimitNoticeForDelivery({
      memberId: "member_group_runtime",
      message: "Murph usage is paused for this chat.",
      noticeCode: "thread_usage_limit_reached",
      prisma: {} as never,
    })).rejects.toThrow("Hosted group usage-limit recovery URL is unavailable.");
  });

  it("keeps one canonical personal recovery handoff without delivery-time authority copy", async () => {
    const message =
      "Murph is paused because the available AI usage is used. "
      + "Review your options in Settings:\n"
      + "https://withmurph.ai/settings?usageRecovery=true#subscription";

    await expect(projectHostedAiUsageLimitNoticeForDelivery({
      memberId: "member_delivery",
      message,
      prisma: {} as never,
    })).resolves.toBe(message);
  });

  it("does not append a second action to neutral personal copy", async () => {
    await expect(projectHostedAiUsageLimitNoticeForDelivery({
      memberId: "member_ineligible",
      message: "Neutral usage notice.",
      prisma: {} as never,
    })).resolves.toBe("Neutral usage notice.");
  });

});
