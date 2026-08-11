import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedSignupReferralRewardNotice: vi.fn(),
  getPrisma: vi.fn(),
  reconcileHostedUsageReferralRewardAfterCommit: vi.fn(),
  recoverPendingHostedSignupReferralRewards: vi.fn(),
  requireVercelCronRequest: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-growth/signup-referral-notification", () => ({
  appendHostedSignupReferralRewardNotice:
    mocks.appendHostedSignupReferralRewardNotice,
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

const ORDINARY_POLICY_VERSION = "hosted-usage-referral-2026-07-v1";
const SIGNUP_POLICY_VERSION =
  "hosted-signup-referral-activation-2026-08-v1";

describe("hosted usage-referral recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendHostedSignupReferralRewardNotice.mockResolvedValue(null);
    mocks.recoverPendingHostedSignupReferralRewards.mockResolvedValue({
      failed: 0,
      rewarded: 0,
      scanned: 0,
    });
    mocks.requireVercelCronRequest.mockReturnValue(undefined);
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue(undefined);
  });

  it("settles signup rewards, queues both notice kinds, and preserves durable wakes", async () => {
    const findReferrals = vi.fn().mockResolvedValue([
      {
        id: "referral_signup_queued",
        policyVersion: SIGNUP_POLICY_VERSION,
      },
      {
        id: "referral_pending",
        policyVersion: ORDINARY_POLICY_VERSION,
      },
      {
        id: "referral_queued",
        policyVersion: ORDINARY_POLICY_VERSION,
      },
      {
        id: "referral_failed",
        policyVersion: ORDINARY_POLICY_VERSION,
      },
    ]);
    const findMailboxItems = vi.fn().mockResolvedValue([
      {
        id: "mailbox_generic_predecessor",
        lane: "conversation",
        laneSeq: 11n,
        userId: "member_existing_source",
      },
    ]);
    const prisma = {
      $queryRaw: findMailboxItems,
      hostedUsageReferral: { findMany: findReferrals },
    };
    mocks.recoverPendingHostedSignupReferralRewards.mockResolvedValue({
      failed: 1,
      rewarded: 2,
      scanned: 3,
    });
    mocks.appendHostedSignupReferralRewardNotice.mockResolvedValueOnce({
      eventId:
        "assistant.notification.requested:usage-referral-reward:referral_signup_queued",
      mailboxItemId: "mailbox_referral_signup_queued",
      source: "linq",
      userId: "member_referrer",
      wakeMailboxCheckpoint: {
        lane: "system",
        laneSeq: 5n,
      },
    });
    mocks.reconcileHostedUsageReferralRewardAfterCommit
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        eventId:
          "assistant.notification.requested:usage-referral-reward:referral_queued",
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
      .mockResolvedValue(undefined);

    await expect(recoverPendingHostedUsageReferrals({
      prisma: prisma as never,
    })).resolves.toEqual({
      failed: 2,
      pending: 1,
      queued: 2,
      resignaled: 1,
      scanned: 8,
    });

    expect(
      mocks.recoverPendingHostedSignupReferralRewards,
    ).toHaveBeenCalledExactlyOnceWith({ prisma });
    expect(findReferrals).toHaveBeenCalledExactlyOnceWith({
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        policyVersion: true,
      },
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
    expect(
      mocks.appendHostedSignupReferralRewardNotice,
    ).toHaveBeenCalledExactlyOnceWith({
      prisma,
      referralId: "referral_signup_queued",
    });
    expect(
      mocks.reconcileHostedUsageReferralRewardAfterCommit,
    ).toHaveBeenNthCalledWith(1, {
      prisma,
      referralId: "referral_pending",
    });
    expect(
      mocks.reconcileHostedUsageReferralRewardAfterCommit,
    ).toHaveBeenNthCalledWith(2, {
      prisma,
      referralId: "referral_queued",
    });
    expect(
      mocks.reconcileHostedUsageReferralRewardAfterCommit,
    ).toHaveBeenNthCalledWith(3, {
      prisma,
      referralId: "referral_failed",
    });
    expect(findMailboxItems).toHaveBeenCalledOnce();
    const pendingMailboxQuery = findMailboxItems.mock.calls[0]?.[0];
    expect(pendingMailboxQuery?.strings.join(" ")).toContain(
      "GREATEST(",
    );
    expect(pendingMailboxQuery?.strings.join(" ")).toContain(
      "referral.lane_seq > lane_cursor.consumed_seq",
    );
    expect(pendingMailboxQuery?.strings.join(" ")).toContain(
      "item.lane_seq > pending_referral_lane.consumed_seq",
    );
    expect(pendingMailboxQuery?.values.filter(
      (value: unknown): value is string => typeof value === "string",
    )).toEqual([
      "assistant.notification.requested:usage-referral-reward:%",
      "assistant.notification.requested:usage-referral-reward:%",
    ]);
    expect(pendingMailboxQuery?.values.at(-1)).toBe(
      HOSTED_USAGE_REFERRAL_RECOVERY_BATCH_SIZE,
    );
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenNthCalledWith(
      1,
      {
        expectedUserId: "member_referrer",
        knownCheckpoint: {
          lane: "system",
          laneSeq: 5n,
          userId: "member_referrer",
        },
        mailboxItemId: "mailbox_referral_signup_queued",
        prisma,
      },
    );
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenNthCalledWith(
      2,
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
      3,
      {
        expectedUserId: "member_existing_source",
        knownCheckpoint: {
          lane: "conversation",
          laneSeq: "11",
          userId: "member_existing_source",
        },
        mailboxItemId: "mailbox_generic_predecessor",
        prisma,
      },
    );
  });

  it("re-signals a legacy mailbox pointer without reading or rewriting its payload", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{
        id: "mailbox_legacy_direct",
        lane: "system",
        laneSeq: 11n,
        userId: "member_legacy_direct",
      }]),
      hostedUsageReferral: { findMany: vi.fn().mockResolvedValue([]) },
    };

    await expect(recoverPendingHostedUsageReferrals({
      prisma: prisma as never,
    })).resolves.toEqual({
      failed: 0,
      pending: 0,
      queued: 0,
      resignaled: 1,
      scanned: 1,
    });

    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledExactlyOnceWith({
      expectedUserId: "member_legacy_direct",
      knownCheckpoint: {
        lane: "system",
        laneSeq: "11",
        userId: "member_legacy_direct",
      },
      mailboxItemId: "mailbox_legacy_direct",
      prisma,
    });
  });

  it("continues ordinary recovery when the gated signup scan throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const findReferrals = vi.fn().mockResolvedValue([]);
    const findMailboxItems = vi.fn().mockResolvedValue([]);
    const prisma = {
      $queryRaw: findMailboxItems,
      hostedUsageReferral: { findMany: findReferrals },
    };
    mocks.recoverPendingHostedSignupReferralRewards.mockRejectedValue(
      new TypeError("invalid signup reward query"),
    );

    await expect(recoverPendingHostedUsageReferrals({
      prisma: prisma as never,
    })).resolves.toEqual({
      failed: 1,
      pending: 0,
      queued: 0,
      resignaled: 0,
      scanned: 0,
    });

    expect(findReferrals).toHaveBeenCalledOnce();
    expect(findMailboxItems).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(
      "Hosted signup referral recovery failed.",
      { errorName: "TypeError" },
    );
    consoleError.mockRestore();
  });

  it("authenticates the cron before running an empty recovery pass", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([]),
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
