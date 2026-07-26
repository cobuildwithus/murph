import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  reconcileHostedUsageReferralRewardAfterCommit: vi.fn(),
  requireVercelCronRequest: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-growth/usage-referral", () => ({
  reconcileHostedUsageReferralRewardAfterCommit:
    mocks.reconcileHostedUsageReferralRewardAfterCommit,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

vi.mock("@/src/lib/hosted-execution/vercel-cron", () => ({
  requireVercelCronRequest: mocks.requireVercelCronRequest,
}));

import { GET } from "@/app/api/internal/hosted-growth/usage-referral/cron/route";
import {
  HOSTED_USAGE_REFERRAL_RECOVERY_BATCH_SIZE,
  recoverPendingHostedUsageReferrals,
} from "@/src/lib/hosted-growth/usage-referral-recovery";

describe("hosted usage-referral recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireVercelCronRequest.mockReturnValue(undefined);
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue(undefined);
  });

  it("bounds retries and keeps a durable celebration when its wake fails", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "referral_pending" },
      { id: "referral_queued" },
      { id: "referral_failed" },
    ]);
    const prisma = {
      hostedUsageReferral: { findMany },
    };
    mocks.reconcileHostedUsageReferralRewardAfterCommit
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        eventId: "assistant.notification.requested:usage-referral-reward:referral_queued",
        mailboxItemId: "mailbox_referral_queued",
        source: "telegram",
        userId: "member_source_group",
        wakeMailboxCheckpoint: {
          lane: "conversation",
          laneSeq: 7n,
        },
      })
      .mockRejectedValueOnce(new Error("temporary route failure"));
    mocks.signalHostedMailboxAppendRuntime.mockRejectedValueOnce(
      new Error("temporary wake failure"),
    );

    await expect(recoverPendingHostedUsageReferrals({
      prisma: prisma as never,
    })).resolves.toEqual({
      failed: 1,
      pending: 1,
      queued: 1,
      scanned: 3,
    });

    expect(findMany).toHaveBeenCalledExactlyOnceWith({
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      select: { id: true },
      take: HOSTED_USAGE_REFERRAL_RECOVERY_BATCH_SIZE,
      where: {
        OR: [
          {
            qualifiedAt: { not: null },
            status: "target_bound",
          },
          {
            celebrationQueuedAt: null,
            status: "rewarded",
          },
        ],
      },
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_source_group",
      knownCheckpoint: {
        lane: "conversation",
        laneSeq: 7n,
        userId: "member_source_group",
      },
      mailboxItemId: "mailbox_referral_queued",
      prisma,
    });
  });

  it("authenticates the cron before running an empty recovery pass", async () => {
    const prisma = {
      hostedUsageReferral: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    mocks.getPrisma.mockReturnValue(prisma);
    const request = new Request(
      "https://example.test/api/internal/hosted-growth/usage-referral/cron",
    );

    const response = await GET(request);

    await expect(response.json()).resolves.toEqual({
      recovery: {
        failed: 0,
        pending: 0,
        queued: 0,
        scanned: 0,
      },
    });
    expect(mocks.requireVercelCronRequest).toHaveBeenCalledExactlyOnceWith(
      request,
    );
    expect(
      mocks.requireVercelCronRequest.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.getPrisma.mock.invocationCallOrder[0] ?? Infinity);
  });
});
