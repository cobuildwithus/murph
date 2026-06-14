import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimHostedAiUsageLimitNotice: vi.fn(),
  readHostedMemberHomeLinqRoute: vi.fn(),
  releaseHostedAiUsageLimitNotice: vi.fn(),
  sendHostedLinqChatMessage: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  claimHostedAiUsageLimitNotice: mocks.claimHostedAiUsageLimitNotice,
  releaseHostedAiUsageLimitNotice: mocks.releaseHostedAiUsageLimitNotice,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  readHostedMemberHomeLinqRoute: mocks.readHostedMemberHomeLinqRoute,
}));

vi.mock("@/src/lib/hosted-onboarding/linq", () => ({
  sendHostedLinqChatMessage: mocks.sendHostedLinqChatMessage,
}));

describe("notifyHostedAiUsageGateDeniedForPendingNudge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends one Linq usage notice for an unclaimed usage-period denial", async () => {
    const prisma = createNoticePrisma();
    mocks.readHostedMemberHomeLinqRoute.mockResolvedValue({
      linqChatId: "chat_notice_1",
    });
    mocks.claimHostedAiUsageLimitNotice.mockResolvedValue(true);
    mocks.sendHostedLinqChatMessage.mockResolvedValue(undefined);

    const { notifyHostedAiUsageGateDeniedForPendingNudge } = await import(
      "@/src/lib/hosted-execution/usage-gate-notice"
    );
    await expect(notifyHostedAiUsageGateDeniedForPendingNudge({
      decision: buildDeniedDecision(),
      memberId: "member_notice_1",
      prisma: prisma as never,
    })).resolves.toEqual({ status: "sent" });

    expect(mocks.readHostedMemberHomeLinqRoute).toHaveBeenCalledWith({
      memberId: "member_notice_1",
      prisma,
    });
    expect(mocks.claimHostedAiUsageLimitNotice).toHaveBeenCalledWith({
      memberId: "member_notice_1",
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      prisma,
      sentAt: expect.any(Date),
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith({
      chatId: "chat_notice_1",
      idempotencyKey: expect.stringMatching(/^ai-usage-gate:[a-f0-9]{32}$/u),
      message:
        "Hey, you've reached your usage limit for the month. Upgrade to Edge: https://withmurph.ai/home",
    });
    expect(mocks.releaseHostedAiUsageLimitNotice).not.toHaveBeenCalled();
  });

  it("does not claim the usage-period notice when no Linq home route exists", async () => {
    const prisma = createNoticePrisma();
    mocks.readHostedMemberHomeLinqRoute.mockResolvedValue(null);

    const { notifyHostedAiUsageGateDeniedForPendingNudge } = await import(
      "@/src/lib/hosted-execution/usage-gate-notice"
    );
    await expect(notifyHostedAiUsageGateDeniedForPendingNudge({
      decision: buildDeniedDecision(),
      memberId: "member_notice_1",
      prisma: prisma as never,
    })).resolves.toEqual({ status: "no_route" });

    expect(mocks.claimHostedAiUsageLimitNotice).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("suppresses delivery when the usage-period notice was already claimed", async () => {
    const prisma = createNoticePrisma();
    mocks.readHostedMemberHomeLinqRoute.mockResolvedValue({
      linqChatId: "chat_notice_1",
    });
    mocks.claimHostedAiUsageLimitNotice.mockResolvedValue(false);

    const { notifyHostedAiUsageGateDeniedForPendingNudge } = await import(
      "@/src/lib/hosted-execution/usage-gate-notice"
    );
    await expect(notifyHostedAiUsageGateDeniedForPendingNudge({
      decision: buildDeniedDecision(),
      memberId: "member_notice_1",
      prisma: prisma as never,
    })).resolves.toEqual({ status: "already_claimed" });

    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("releases the claim so a later denial retries when the Linq send fails", async () => {
    const prisma = createNoticePrisma();
    mocks.readHostedMemberHomeLinqRoute.mockResolvedValue({
      linqChatId: "chat_notice_1",
    });
    mocks.claimHostedAiUsageLimitNotice.mockResolvedValue(true);
    mocks.sendHostedLinqChatMessage.mockRejectedValue(new Error("boom"));
    mocks.releaseHostedAiUsageLimitNotice.mockResolvedValue(undefined);

    const { notifyHostedAiUsageGateDeniedForPendingNudge } = await import(
      "@/src/lib/hosted-execution/usage-gate-notice"
    );
    await expect(notifyHostedAiUsageGateDeniedForPendingNudge({
      decision: buildDeniedDecision(),
      memberId: "member_notice_1",
      prisma: prisma as never,
    })).resolves.toEqual({ status: "failed" });

    expect(mocks.claimHostedAiUsageLimitNotice).toHaveBeenCalledWith({
      memberId: "member_notice_1",
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      prisma,
      sentAt: expect.any(Date),
    });
    const claimedSentAt = mocks.claimHostedAiUsageLimitNotice.mock.calls[0]?.[0]?.sentAt;
    expect(mocks.releaseHostedAiUsageLimitNotice).toHaveBeenCalledWith({
      memberId: "member_notice_1",
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      prisma,
      sentAt: claimedSentAt,
    });
  });

  it("still reports failed delivery when the claim release also fails", async () => {
    const prisma = createNoticePrisma();
    mocks.readHostedMemberHomeLinqRoute.mockResolvedValue({
      linqChatId: "chat_notice_1",
    });
    mocks.claimHostedAiUsageLimitNotice.mockResolvedValue(true);
    mocks.sendHostedLinqChatMessage.mockRejectedValue(new Error("boom"));
    mocks.releaseHostedAiUsageLimitNotice.mockRejectedValue(new Error("release boom"));

    const { notifyHostedAiUsageGateDeniedForPendingNudge } = await import(
      "@/src/lib/hosted-execution/usage-gate-notice"
    );
    await expect(notifyHostedAiUsageGateDeniedForPendingNudge({
      decision: buildDeniedDecision(),
      memberId: "member_notice_1",
      prisma: prisma as never,
    })).resolves.toEqual({ status: "failed" });
  });

  it("reports failed delivery when the notice claim lookup fails", async () => {
    const prisma = createNoticePrisma();
    mocks.readHostedMemberHomeLinqRoute.mockResolvedValue({
      linqChatId: "chat_notice_1",
    });
    mocks.claimHostedAiUsageLimitNotice.mockRejectedValue(new Error("claim failed"));

    const { notifyHostedAiUsageGateDeniedForPendingNudge } = await import(
      "@/src/lib/hosted-execution/usage-gate-notice"
    );
    await expect(notifyHostedAiUsageGateDeniedForPendingNudge({
      decision: buildDeniedDecision(),
      memberId: "member_notice_1",
      prisma: prisma as never,
    })).resolves.toEqual({ status: "failed" });

    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.releaseHostedAiUsageLimitNotice).not.toHaveBeenCalled();
  });

  it("ignores gate denials without a usage-limit notice", async () => {
    const prisma = createNoticePrisma();
    const { notifyHostedAiUsageGateDeniedForPendingNudge } = await import(
      "@/src/lib/hosted-execution/usage-gate-notice"
    );
    await expect(notifyHostedAiUsageGateDeniedForPendingNudge({
      decision: {
        ...buildDeniedDecision(),
        reason: "hosted_access_inactive",
        userNotice: null,
      },
      memberId: "member_notice_1",
      prisma: prisma as never,
    })).resolves.toEqual({ status: "not_applicable" });

    expect(mocks.readHostedMemberHomeLinqRoute).not.toHaveBeenCalled();
  });

  it("rejects transaction-compatible clients before claiming or sending", async () => {
    const { sendHostedAiUsageLimitNotice } = await import(
      "@/src/lib/hosted-execution/usage-gate-notice"
    );

    await expect(sendHostedAiUsageLimitNotice({
      memberId: "member_notice_1",
      notice: buildDeniedDecision().userNotice,
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      prisma: {} as never,
    })).rejects.toThrow("requires a PrismaClient owner");

    expect(mocks.readHostedMemberHomeLinqRoute).not.toHaveBeenCalled();
    expect(mocks.claimHostedAiUsageLimitNotice).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.releaseHostedAiUsageLimitNotice).not.toHaveBeenCalled();
  });
});

function createNoticePrisma() {
  return {
    $transaction: vi.fn(),
  };
}

function buildDeniedDecision() {
  return {
    allowed: false as const,
    billingPlanCode: "launch_monthly" as const,
    limitUsdMicros: 10_000_000n,
    memberId: "member_notice_1",
    periodEnd: new Date("2026-05-01T00:00:00.000Z"),
    periodStart: new Date("2026-04-01T00:00:00.000Z"),
    reason: "ai_usage_limit_exceeded" as const,
    remainingUsdMicros: 0n,
    retryAfter: new Date("2026-05-01T00:00:00.000Z"),
    spentUsdMicros: 10_000_000n,
    userNotice: {
      code: "pulse_upgrade_edge" as const,
      message:
        "Hey, you've reached your usage limit for the month. Upgrade to Edge: https://withmurph.ai/home",
    },
  };
}
