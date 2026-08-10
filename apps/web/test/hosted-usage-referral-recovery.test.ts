import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildHostedExecutionAssistantNotificationRequestedWake,
} from "@murphai/hosted-execution";

const mocks = vi.hoisted(() => ({
  acquireHostedMemberHomeLinqRouteLockTx: vi.fn(),
  appendHostedSignupReferralRewardNotice: vi.fn(),
  assertHostedDirectAssistantNotificationRouteAuthority: vi.fn(),
  getPrisma: vi.fn(),
  readHostedMailboxWakeByItemId: vi.fn(),
  reconcileHostedUsageReferralRewardAfterCommit: vi.fn(),
  recoverPendingHostedSignupReferralRewards: vi.fn(),
  replaceUnconsumedHostedMailboxEnvelopePayloadTx: vi.fn(),
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

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  readHostedMailboxWakeByItemId: mocks.readHostedMailboxWakeByItemId,
  replaceUnconsumedHostedMailboxEnvelopePayloadTx:
    mocks.replaceUnconsumedHostedMailboxEnvelopePayloadTx,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  acquireHostedMemberHomeLinqRouteLockTx:
    mocks.acquireHostedMemberHomeLinqRouteLockTx,
}));

vi.mock(
  "@/src/lib/hosted-routing/assistant-notification-destination",
  () => ({
    assertHostedDirectAssistantNotificationRouteAuthority:
      mocks.assertHostedDirectAssistantNotificationRouteAuthority,
  }),
);

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
    mocks.acquireHostedMemberHomeLinqRouteLockTx.mockResolvedValue(undefined);
    mocks.assertHostedDirectAssistantNotificationRouteAuthority.mockResolvedValue(
      undefined,
    );
    mocks.readHostedMailboxWakeByItemId.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => input.mailboxItemId === "mailbox_referral_existing"
      ? buildCelebrationWake({
          authority: {
            channel: "linq",
            containerMemberId: "member_existing_source",
            threadId: "provider-existing-group",
          },
          eventId:
            "assistant.notification.requested:usage-referral-reward:existing",
          memberId: "member_existing_source",
          route: {
            actorId: null,
            channel: "linq",
            delivery: {
              kind: "thread",
              target: "provider-existing-group",
            },
            identityId: "existing-group-identity",
            threadId: "existing-group-thread",
            threadIsDirect: false,
          },
        })
      : null);
    mocks.recoverPendingHostedSignupReferralRewards.mockResolvedValue({
      failed: 0,
      rewarded: 0,
      scanned: 0,
    });
    mocks.replaceUnconsumedHostedMailboxEnvelopePayloadTx.mockResolvedValue(
      null,
    );
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
        dedupeKey:
          "assistant.notification.requested:usage-referral-reward:existing",
        id: "mailbox_referral_existing",
        lane: "conversation",
        laneSeq: 11n,
        payloadHash: "hmac-sha256:existing",
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
    expect(findMailboxItems).toHaveBeenCalledExactlyOnceWith({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        dedupeKey: true,
        id: true,
        lane: true,
        laneSeq: true,
        payloadHash: true,
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
      },
    });
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
        mailboxItemId: "mailbox_referral_existing",
        prisma,
      },
    );
  });

  it("repairs one legacy direct Linq head in place before re-signaling it", async () => {
    const memberId = "member_legacy_direct";
    const eventId =
      "assistant.notification.requested:usage-referral-reward:legacy-direct";
    const mailboxItemId = "mailbox_legacy_direct";
    const payloadHash = "hmac-sha256:legacy-direct";
    const legacyWake = buildCelebrationWake({
      authority: null,
      eventId,
      memberId,
      route: {
        actorId: "linq-participant",
        channel: "linq",
        delivery: {
          kind: "explicit",
          target: "provider-direct-thread",
        },
        identityId: "direct-identity",
        threadId: "direct-thread",
        threadIsDirect: true,
      },
    });
    const findMailboxItems = vi.fn().mockResolvedValue([{
      dedupeKey: eventId,
      id: mailboxItemId,
      lane: "system",
      laneSeq: 11n,
      payloadHash,
      userId: memberId,
    }]);
    const tx = { kind: "transaction" };
    let transactionCommitted = false;
    const transaction = vi.fn(async (
      operation: (transactionClient: typeof tx) => Promise<unknown>,
    ) => {
      const result = await operation(tx);
      transactionCommitted = true;
      return result;
    });
    const prisma = {
      $transaction: transaction,
      hostedMailboxItem: { findMany: findMailboxItems },
      hostedUsageReferral: { findMany: vi.fn().mockResolvedValue([]) },
    };
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue(legacyWake);
    mocks.replaceUnconsumedHostedMailboxEnvelopePayloadTx.mockResolvedValue({
      id: mailboxItemId,
      lane: "system",
      laneSeq: "11",
      userId: memberId,
    });
    mocks.signalHostedMailboxAppendRuntime.mockImplementation(async () => {
      expect(transactionCommitted).toBe(true);
    });

    await expect(recoverPendingHostedUsageReferrals({
      prisma: prisma as never,
    })).resolves.toEqual({
      failed: 0,
      pending: 0,
      queued: 0,
      resignaled: 1,
      scanned: 1,
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(mocks.acquireHostedMemberHomeLinqRouteLockTx).toHaveBeenCalledWith({
      memberId,
      prisma: tx,
    });
    const authority = {
      channel: "linq",
      containerMemberId: memberId,
      threadId: "provider-direct-thread",
    } as const;
    expect(
      mocks.assertHostedDirectAssistantNotificationRouteAuthority,
    ).toHaveBeenCalledWith({
      authority,
      prisma: tx,
      requireThreadDelivery: true,
    });
    expect(
      mocks.replaceUnconsumedHostedMailboxEnvelopePayloadTx,
    ).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId,
        notification: expect.objectContaining({
          externalThreadRouteAuthority: authority,
          route: legacyWake.notification.route,
        }),
        userId: memberId,
      }),
      expectedPayloadHash: payloadHash,
      mailboxItemId,
      tx,
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: memberId,
      knownCheckpoint: {
        lane: "system",
        laneSeq: "11",
        userId: memberId,
      },
      mailboxItemId,
      prisma,
    });
    expect(
      mocks.replaceUnconsumedHostedMailboxEnvelopePayloadTx.mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      mocks.signalHostedMailboxAppendRuntime.mock.invocationCallOrder[0]
        ?? Infinity,
    );
  });

  it("does not rewrite or signal a legacy head after direct route authority goes stale", async () => {
    const memberId = "member_stale_direct";
    const eventId =
      "assistant.notification.requested:usage-referral-reward:stale-direct";
    const prisma = {
      $transaction: vi.fn(async (operation: (tx: object) => Promise<unknown>) =>
        operation({ kind: "transaction" })
      ),
      hostedMailboxItem: {
        findMany: vi.fn().mockResolvedValue([{
          dedupeKey: eventId,
          id: "mailbox_stale_direct",
          lane: "system",
          laneSeq: 3n,
          payloadHash: "hmac-sha256:stale-direct",
          userId: memberId,
        }]),
      },
      hostedUsageReferral: { findMany: vi.fn().mockResolvedValue([]) },
    };
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue(buildCelebrationWake({
      authority: null,
      eventId,
      memberId,
      route: {
        actorId: "linq-participant",
        channel: "linq",
        delivery: {
          kind: "explicit",
          target: "provider-stale-thread",
        },
        identityId: "direct-identity",
        threadId: "direct-thread",
        threadIsDirect: true,
      },
    }));
    mocks.assertHostedDirectAssistantNotificationRouteAuthority.mockRejectedValue(
      new Error("route moved"),
    );

    await expect(recoverPendingHostedUsageReferrals({
      prisma: prisma as never,
    })).resolves.toEqual({
      failed: 0,
      pending: 0,
      queued: 0,
      resignaled: 0,
      scanned: 1,
    });

    expect(
      mocks.replaceUnconsumedHostedMailboxEnvelopePayloadTx,
    ).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("continues ordinary recovery when the gated signup scan throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const findReferrals = vi.fn().mockResolvedValue([]);
    const findMailboxItems = vi.fn().mockResolvedValue([]);
    const prisma = {
      hostedMailboxItem: { findMany: findMailboxItems },
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

function buildCelebrationWake(input: {
  authority: {
    channel: "linq" | "telegram";
    containerMemberId: string;
    threadId: string;
  } | null;
  eventId: string;
  memberId: string;
  route: Parameters<
    typeof buildHostedExecutionAssistantNotificationRequestedWake
  >[0]["notification"]["route"];
}) {
  const notificationKey = input.eventId.slice(
    "assistant.notification.requested:".length,
  );
  return buildHostedExecutionAssistantNotificationRequestedWake({
    eventId: input.eventId,
    memberId: input.memberId,
    notification: {
      deliveryDedupeToken: notificationKey,
      deliveryDispatchMode: "queue-only",
      deliveryIdempotencyKey: notificationKey,
      ...(input.authority
        ? { externalThreadRouteAuthority: input.authority }
        : {}),
      instructions: "Celebrate the completed referral reward.",
      responsePolicy: { kind: "require_send" },
      route: input.route,
    },
    occurredAt: "2026-08-10T12:00:00.000Z",
  });
}
