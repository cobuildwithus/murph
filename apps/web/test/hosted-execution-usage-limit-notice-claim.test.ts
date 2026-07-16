import { beforeEach, describe, expect, it, vi } from "vitest";

const claimMocks = vi.hoisted(() => ({
  assertHostedLinqRouteAuthorityMatchesTarget: vi.fn(),
  assertHostedThreadRouteEgressAuthority: vi.fn(),
  lockHostedMemberRoutingStateTx: vi.fn(),
  lockHostedThreadRouteByThreadIdentityTx: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
  startHostedAiUsageLimitNoticeDispatchTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  lockHostedMemberRoutingStateTx: claimMocks.lockHostedMemberRoutingStateTx,
  readHostedMemberRoutingState: claimMocks.readHostedMemberRoutingState,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-delivery-store", () => ({
  startHostedAiUsageLimitNoticeDispatchTx:
    claimMocks.startHostedAiUsageLimitNoticeDispatchTx,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-egress-engagement", () => ({
  assertHostedLinqRouteAuthorityMatchesTarget:
    claimMocks.assertHostedLinqRouteAuthorityMatchesTarget,
}));

vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  assertHostedThreadRouteEgressAuthority:
    claimMocks.assertHostedThreadRouteEgressAuthority,
  lockHostedThreadRouteByThreadIdentityTx:
    claimMocks.lockHostedThreadRouteByThreadIdentityTx,
}));

import {
  hostedOnboardingError,
} from "@/src/lib/hosted-onboarding/errors";
import {
  startAuthorizedHostedAiUsageLimitNoticeDispatchTx,
} from "@/src/lib/hosted-execution/usage-limit-notice-claim";

const attemptedAt = new Date("2026-07-12T15:00:00.000Z");
const periodStart = new Date("2026-07-01T00:00:00.000Z");
const transaction = {
  $queryRaw: vi.fn(),
};
const prisma = {
  $transaction: vi.fn(async (
    operation: (tx: typeof transaction) => Promise<unknown>,
  ) => await operation(transaction)),
};

describe("hosted usage-limit notice claim authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    claimMocks.lockHostedMemberRoutingStateTx.mockResolvedValue(undefined);
    claimMocks.lockHostedThreadRouteByThreadIdentityTx.mockResolvedValue(undefined);
    claimMocks.assertHostedThreadRouteEgressAuthority.mockResolvedValue({});
    transaction.$queryRaw.mockResolvedValue([{ eligible: true }]);
    claimMocks.startHostedAiUsageLimitNoticeDispatchTx.mockImplementation(
      async (input: {
        assertDispatchAuthority?: (prisma: typeof transaction) => Promise<void>;
        prisma: typeof transaction;
      }) => {
        await input.assertDispatchAuthority?.(input.prisma);
        return {
          idempotencyKey: "usage_notice_claim_1",
          status: "claimed",
        };
      },
    );
  });

  it("locks and claims an exact personal Linq target in one transaction", async () => {
    claimMocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: "linq_chat_current",
    });

    await expect(startAuthorizedHostedAiUsageLimitNoticeDispatchTx({
      attemptedAt,
      memberId: "member_usage_notice_1",
      noticeDeliveryTarget: {
        channel: "linq",
        replyToMessageId: "linq_message_1",
        routeAuthority: null,
        target: "linq_chat_current",
      },
      periodStart,
      prisma: prisma as never,
      source: "hosted_webhook_side_effect",
      sourceRef: "usage_event_1",
      targetKind: "thread",
      usageCreditLedgerVersion: 4n,
    })).resolves.toEqual({
      idempotencyKey: "usage_notice_claim_1",
      status: "claimed",
    });

    expect(claimMocks.lockHostedMemberRoutingStateTx).toHaveBeenCalledWith({
      memberId: "member_usage_notice_1",
      prisma: transaction,
    });
    expect(claimMocks.startHostedAiUsageLimitNoticeDispatchTx).toHaveBeenCalledWith({
      assertDispatchAuthority: expect.any(Function),
      attemptedAt,
      linqChatId: "linq_chat_current",
      memberId: "member_usage_notice_1",
      periodStart,
      prisma: transaction,
      source: "hosted_webhook_side_effect",
      sourceRef: "usage_event_1",
      targetKind: "thread",
      usageCreditLedgerVersion: 4n,
    });
  });

  it("rejects a stale personal Linq target inside the delivery claim transaction", async () => {
    claimMocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: "linq_chat_new",
    });

    await expect(startAuthorizedHostedAiUsageLimitNoticeDispatchTx({
      attemptedAt,
      memberId: "member_usage_notice_1",
      noticeDeliveryTarget: {
        channel: "linq",
        replyToMessageId: "linq_message_1",
        routeAuthority: null,
        target: "linq_chat_old",
      },
      periodStart,
      prisma: prisma as never,
      source: "hosted_webhook_side_effect",
      sourceRef: "usage_event_1",
      targetKind: "thread",
      usageCreditLedgerVersion: 4n,
    })).resolves.toEqual({ status: "not_authorized" });

    expect(claimMocks.startHostedAiUsageLimitNoticeDispatchTx).toHaveBeenCalledWith(
      expect.objectContaining({
        assertDispatchAuthority: expect.any(Function),
        linqChatId: "linq_chat_old",
        prisma: transaction,
      }),
    );
  });

  it("rejects a stale Telegram target inside the delivery claim transaction", async () => {
    claimMocks.readHostedMemberRoutingState.mockResolvedValue({
      telegramThreadId: "telegram_thread_new",
    });

    await expect(startAuthorizedHostedAiUsageLimitNoticeDispatchTx({
      attemptedAt,
      memberId: "member_usage_notice_1",
      noticeDeliveryTarget: {
        channel: "telegram",
        replyToMessageId: "telegram_message_1",
        target: "telegram_thread_old",
      },
      periodStart,
      prisma: prisma as never,
      source: "hosted_runtime_ai_usage_limit_notice",
      sourceRef: "usage_event_1",
      targetKind: "telegram_thread",
      usageCreditLedgerVersion: 4n,
    })).resolves.toEqual({ status: "not_authorized" });

    expect(claimMocks.startHostedAiUsageLimitNoticeDispatchTx).toHaveBeenCalledWith(
      expect.objectContaining({
        assertDispatchAuthority: expect.any(Function),
        prisma: transaction,
      }),
    );
  });

  it("declines a notice when its allowance period is no longer blocked", async () => {
    claimMocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: "linq_chat_current",
    });
    transaction.$queryRaw
      .mockResolvedValueOnce([{ eligible: true }])
      .mockResolvedValueOnce([]);

    await expect(startAuthorizedHostedAiUsageLimitNoticeDispatchTx({
      attemptedAt,
      memberId: "member_usage_notice_1",
      noticeDeliveryTarget: {
        channel: "linq",
        replyToMessageId: "linq_message_1",
        routeAuthority: null,
        target: "linq_chat_current",
      },
      periodStart,
      prisma: prisma as never,
      source: "hosted_webhook_side_effect",
      sourceRef: "usage_event_1",
      targetKind: "thread",
      usageCreditLedgerVersion: 4n,
    })).resolves.toEqual({ status: "already_notified" });

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("rejects a pre-top-up capacity epoch and accepts the re-exhaustion epoch", async () => {
    claimMocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: "linq_chat_current",
    });
    transaction.$queryRaw.mockResolvedValueOnce([]);

    await expect(startAuthorizedHostedAiUsageLimitNoticeDispatchTx({
      attemptedAt,
      memberId: "member_usage_notice_1",
      noticeDeliveryTarget: {
        channel: "linq",
        replyToMessageId: "linq_message_old_crossing",
        routeAuthority: null,
        target: "linq_chat_current",
      },
      periodStart,
      prisma: prisma as never,
      source: "hosted_webhook_side_effect",
      sourceRef: "usage_event_before_top_up",
      targetKind: "thread",
      usageCreditLedgerVersion: 4n,
    })).resolves.toEqual({ status: "already_notified" });

    expect(claimMocks.readHostedMemberRoutingState).not.toHaveBeenCalled();

    transaction.$queryRaw.mockResolvedValue([{ eligible: true }]);
    await expect(startAuthorizedHostedAiUsageLimitNoticeDispatchTx({
      attemptedAt,
      memberId: "member_usage_notice_1",
      noticeDeliveryTarget: {
        channel: "linq",
        replyToMessageId: "linq_message_reexhaustion",
        routeAuthority: null,
        target: "linq_chat_current",
      },
      periodStart,
      prisma: prisma as never,
      source: "hosted_webhook_side_effect",
      sourceRef: "usage_event_after_top_up",
      targetKind: "thread",
      usageCreditLedgerVersion: 6n,
    })).resolves.toEqual({
      idempotencyKey: "usage_notice_claim_1",
      status: "claimed",
    });
  });

  it("locks and reasserts external Linq authority before declining a stale route", async () => {
    const authority = {
      accountLookupKey: "account_lookup_1",
      channel: "linq" as const,
      containerMemberId: "member_usage_notice_1",
      threadId: "linq_chat_external",
    };
    claimMocks.assertHostedLinqRouteAuthorityMatchesTarget.mockReturnValue(authority);
    claimMocks.assertHostedThreadRouteEgressAuthority.mockRejectedValue(
      hostedOnboardingError({
        code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
        httpStatus: 403,
        message: "External thread route egress is no longer authorized.",
        retryable: false,
      }),
    );

    await expect(startAuthorizedHostedAiUsageLimitNoticeDispatchTx({
      attemptedAt,
      memberId: "member_usage_notice_1",
      noticeDeliveryTarget: {
        channel: "linq",
        replyToMessageId: "linq_message_1",
        routeAuthority: authority,
        target: "linq_chat_external",
      },
      periodStart,
      prisma: prisma as never,
      source: "hosted_webhook_side_effect",
      sourceRef: "usage_event_1",
      targetKind: "thread",
      usageCreditLedgerVersion: 4n,
    })).resolves.toEqual({ status: "not_authorized" });

    expect(claimMocks.lockHostedThreadRouteByThreadIdentityTx).toHaveBeenCalledWith({
      authority,
      prisma: transaction,
    });
    expect(claimMocks.startHostedAiUsageLimitNoticeDispatchTx).toHaveBeenCalledWith(
      expect.objectContaining({
        assertDispatchAuthority: expect.any(Function),
        linqChatId: "linq_chat_external",
        prisma: transaction,
      }),
    );
  });
});
