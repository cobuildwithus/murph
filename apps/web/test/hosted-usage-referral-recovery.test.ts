import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  reconcileHostedUsageReferralRewardAfterCommit: vi.fn(),
  recoverPendingHostedSignupReferralRewards: vi.fn(),
  requireVercelCronRequest: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-growth/signup-referral-reward", () => ({
  recoverPendingHostedSignupReferralRewards:
    mocks.recoverPendingHostedSignupReferralRewards,
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

const SIGNUP_POLICY_VERSION =
  "hosted-signup-referral-activation-2026-08-v1";

describe("hosted usage-referral recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recoverPendingHostedSignupReferralRewards.mockResolvedValue({
      failed: 0,
      rewarded: 0,
      scanned: 0,
    });
    mocks.requireVercelCronRequest.mockReturnValue(undefined);
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue(undefined);
  });

  it("settles signup rewards, bounds retries, and preserves durable wakes", async () => {
    const findReferrals = vi.fn().mockResolvedValue([
      { id: "referral_pending" },
      { id: "referral_queued" },
      { id: "referral_failed" },
    ]);
    const findMailboxItems = vi.fn().mockResolvedValue([
      {
        id: "mailbox_referral_existing",
        laneSeq: 11n,
        userId: "member_existing_source",
      },
    ]);
    const prisma = {
      hostedMailboxItem: { findMany: findMailboxItems },
      hostedUsageReferral: { findMany: findReferrals },
    };
    mocks.recoverPendingHostedSignupReferralRewards.mockResolvedValue({
      failed: 1,
      rewarded: 2,
      scanned: 3,
    });
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
    mocks.signalHostedMailboxAppendRuntime
      .mockRejectedValueOnce(new Error("temporary wake failure"))
      .mockResolvedValueOnce(undefined);

    await expect(recoverPendingHostedUsageReferrals({
      prisma: prisma as never,
    })).resolves.toEqual({
      failed: 2,
      pending: 1,
      queued: 1,
      resignaled: 1,
      scanned: 7,
    });

    expect(
      mocks.recoverPendingHostedSignupReferralRewards,
    ).toHaveBeenCalledExactlyOnceWith({ prisma });
    expect(findReferrals).toHaveBeenCalledExactlyOnceWith({
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
            OR: [
              {
                policyVersion: {
                  not: SIGNUP_POLICY_VERSION,
                },
              },
              {
                policyVersion: SIGNUP_POLICY_VERSION,
                sourceConversationJson: { not: Prisma.DbNull },
              },
            ],
          },
        ],
      },
    });
    expect(findMailboxItems).toHaveBeenCalledExactlyOnceWith({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        laneSeq: true,
        userId: true,
      },
      take: HOSTED_USAGE_REFERRAL_RECOVERY_BATCH_SIZE,
      where: {
        consumedAt: null,
        dedupeKey: {
          startsWith:
            "assistant.notification.requested:usage-referral-reward:",
        },
        kind: "assistant.notification.requested",
        lane: "system",
      },
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenNthCalledWith(
      1,
      {
        expectedUserId: "member_source_group",
        knownCheckpoint: {
          lane: "conversation",
          laneSeq: 7n,
          userId: "member_source_group",
        },
        mailboxItemId: "mailbox_referral_queued",
        prisma,
      },
    );
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenNthCalledWith(
      2,
      {
        expectedUserId: "member_existing_source",
        knownCheckpoint: {
          lane: "system",
          laneSeq: "11",
          userId: "member_existing_source",
        },
        mailboxItemId: "mailbox_referral_existing",
        prisma,
      },
    );
  });

  it("authenticates the cron before running an empty recovery pass", async () => {
    const prisma = {
      hostedMailboxItem: {
        findMany: vi.fn().mockResolvedValue([]),
      },
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
        resignaled: 0,
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
