import { HostedBillingStatus } from "@prisma/client";
import type { HostedMailboxItem } from "@murphai/hosted-execution/runtime-control";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createHostedExternalThreadLookupKey,
  createHostedPhoneLookupKey,
} from "../src/lib/hosted-onboarding/contact-privacy";
import {
  planHostedOnboardingLinqWebhook,
} from "../src/lib/hosted-onboarding/webhook-provider-linq";

vi.mock("../src/lib/hosted-mailbox/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/hosted-mailbox/store")>();
  return {
    ...actual,
    appendHostedMailboxEnvelopeTx: vi.fn(),
    readHostedMailboxItemByDedupeKey: vi.fn(),
  };
});

vi.mock("../src/lib/hosted-execution/usage-allowance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/hosted-execution/usage-allowance")>();
  return {
    ...actual,
    checkHostedAiUsageGate: vi.fn(),
    claimHostedAiUsageLimitNotice: vi.fn(),
  };
});

vi.mock("../src/lib/hosted-onboarding/linq-daily-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/hosted-onboarding/linq-daily-state")>();
  return {
    ...actual,
    incrementHostedLinqInboundDailyState: vi.fn(),
    incrementHostedLinqOutboundDailyState: vi.fn(),
  };
});

const mailboxStore = await import("../src/lib/hosted-mailbox/store");
const usageAllowance = await import("../src/lib/hosted-execution/usage-allowance");
const linqDailyState = await import("../src/lib/hosted-onboarding/linq-daily-state");

beforeEach(() => {
  vi.clearAllMocks();
});

function buildLinqMessageReceivedEvent(input: {
  chatId?: string;
  eventId?: string;
  isFromMe?: boolean;
  isGroup?: boolean;
  messageId?: string;
  recipient?: string;
  sender?: string;
  text?: string;
}) {
  const recipient = input.recipient ?? "+15550000000";
  return {
    api_version: "2026-01-01",
    created_at: "2026-06-24T12:00:00.000Z",
    data: {
      chat: {
        id: input.chatId ?? "chat_group_123",
        is_group: input.isGroup ?? true,
        owner_handle: {
          handle: recipient,
          id: "owner_handle_123",
          is_me: true,
          service: "iMessage",
        },
      },
      chat_id: input.chatId ?? "chat_group_123",
      direction: input.isFromMe ? "outbound" : "inbound",
      from: input.sender ?? "+15551112222",
      is_from_me: input.isFromMe ?? false,
      message: {
        id: input.messageId ?? "msg_group_123",
        parts: input.text === ""
          ? []
          : [
              {
                type: "text",
                value: input.text ?? "How did we sleep?",
              },
            ],
      },
      preferred_service: "iMessage",
      recipient_phone: recipient,
      received_at: "2026-06-24T12:00:00.000Z",
      sender_handle: {
        handle: input.sender ?? "+15551112222",
        id: "sender_handle_123",
        is_me: false,
        service: "iMessage",
      },
      service: "iMessage",
    },
    event_id: input.eventId ?? "evt_group_123",
    event_type: "message.received",
  };
}

function createPrisma(input: {
  routeAccountPhone?: string;
  routeContainerMemberId?: string | null;
  routeContainerActive?: boolean;
  routeOwnerActive?: boolean;
} = {}) {
  const routeAccountLookupKey = createHostedPhoneLookupKey(
    input.routeAccountPhone ?? "+15550000000",
  );
  const routeContainerMemberId = input.routeContainerMemberId ?? null;
  const routeContainerActive = input.routeContainerActive ?? true;
  const routeOwnerActive = input.routeOwnerActive ?? true;
  const hostedThreadRoute = {
    findMany: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      if (!routeContainerMemberId) {
        return [];
      }
      const lookupKeys = (where.threadLookupKey as { in?: string[] } | undefined)?.in ?? [];
      const expected = createHostedExternalThreadLookupKey({
        accountLookupKey: routeAccountLookupKey,
        channel: "linq",
        threadId: "chat_group_123",
      });
      if (!expected || !lookupKeys.includes(expected)) {
        return [];
      }
      return [
        {
          channel: "linq",
          container: {
            member: {
              billingStatus: routeContainerActive
                ? HostedBillingStatus.active
                : HostedBillingStatus.paused,
              createdAt: new Date("2026-06-24T00:00:00.000Z"),
              id: routeContainerMemberId,
              suspendedAt: null,
              updatedAt: new Date("2026-06-24T00:00:00.000Z"),
            },
            owner: {
              billingStatus: routeOwnerActive
                ? HostedBillingStatus.active
                : HostedBillingStatus.paused,
              createdAt: new Date("2026-06-24T00:00:00.000Z"),
              id: "member_owner_123",
              suspendedAt: null,
              updatedAt: new Date("2026-06-24T00:00:00.000Z"),
            },
          },
          containerMemberId: routeContainerMemberId,
        },
      ];
    }),
  };
  const hostedMemberRouting = {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn(),
  };
  const hostedMember = {
    findUnique: vi.fn().mockResolvedValue(null),
  };
  const hostedWorkspace = {
    upsert: vi.fn().mockResolvedValue({}),
  };

  return {
    hostedMember,
    hostedMemberRouting,
    hostedThreadRoute,
    hostedWorkspace,
  };
}

function buildHostedMailboxItem(input: {
  id: string;
  userId: string;
}): HostedMailboxItem {
  const now = "2026-06-24T12:00:00.000Z";

  return {
    createdAt: now,
    dedupeKey: "evt_group_123",
    expiresAt: null,
    id: input.id,
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: "1",
    occurredAt: now,
    payloadBytes: 123,
    payloadInlineCiphertext: null,
    payloadRef: null,
    payloadSchema: "murph.hosted-mailbox-item.v1",
    updatedAt: now,
    userId: input.userId,
  };
}

describe("Linq explicit external-thread routing", () => {
  it("routes a bound Linq group thread into the container runtime", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
    });
    vi.mocked(mailboxStore.readHostedMailboxItemByDedupeKey).mockResolvedValueOnce(null);
    vi.mocked(linqDailyState.incrementHostedLinqInboundDailyState).mockResolvedValueOnce({
      dayUtc: new Date("2026-06-24T00:00:00.000Z"),
      inboundCount: 1,
      memberId: "member_thread_container_123",
      outboundCount: 0,
      quotaReplySentAt: null,
    } as Awaited<ReturnType<typeof linqDailyState.incrementHostedLinqInboundDailyState>>);
    vi.mocked(usageAllowance.checkHostedAiUsageGate).mockResolvedValueOnce({
      allowed: true,
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 4_500_000n,
      memberId: "member_thread_container_123",
      periodEnd: new Date("2026-07-01T00:00:00.000Z"),
      periodStart: new Date("2026-06-01T00:00:00.000Z"),
      remainingUsdMicros: 4_500_000n,
      spentUsdMicros: 0n,
    });
    vi.mocked(mailboxStore.appendHostedMailboxEnvelopeTx).mockResolvedValueOnce({
      dedupeConflict: false,
      duplicate: false,
      inserted: true,
      item: buildHostedMailboxItem({
        id: "mailbox_group_123",
        userId: "member_thread_container_123",
      }),
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(plan.wakeUserId).toBe("member_thread_container_123");
    expect(plan.wakeMailboxItemId).toBe("mailbox_group_123");
    expect(plan.wakeLinqChatId).toBe("chat_group_123");
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: "evt_group_123",
        kind: "conversation.message",
        message: expect.objectContaining({
          accountLookupKey: createHostedPhoneLookupKey("+15550000000"),
          channel: "linq",
          linqMessage: expect.objectContaining({
            chatId: "chat_group_123",
            from: "+15551112222",
            messageId: "msg_group_123",
            threadIsDirect: false,
          }),
        }),
        userId: "member_thread_container_123",
      }),
      tx: prisma,
    });
    expect(prisma.hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.updateMany).not.toHaveBeenCalled();
  });

  it("does not match a routed thread for another Linq recipient line with the same chat id", async () => {
    const prisma = createPrisma({
      routeAccountPhone: "+15550000000",
      routeContainerMemberId: "member_thread_container_123",
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({
        recipient: "+15559999999",
      }),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "group-chat",
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("uses the existing Linq daily quota gate for routed thread traffic", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
    });
    vi.mocked(mailboxStore.readHostedMailboxItemByDedupeKey).mockResolvedValueOnce(null);
    vi.mocked(linqDailyState.incrementHostedLinqInboundDailyState).mockResolvedValueOnce({
      dayUtc: new Date("2026-06-24T00:00:00.000Z"),
      inboundCount: linqDailyState.HOSTED_LINQ_DAILY_TEXT_LIMIT + 1,
      memberId: "member_thread_container_123",
      outboundCount: 0,
      quotaReplySentAt: null,
    } as Awaited<ReturnType<typeof linqDailyState.incrementHostedLinqInboundDailyState>>);
    vi.mocked(usageAllowance.checkHostedAiUsageGate).mockResolvedValueOnce({
      allowed: true,
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 4_500_000n,
      memberId: "member_thread_container_123",
      periodEnd: new Date("2026-07-01T00:00:00.000Z"),
      periodStart: new Date("2026-06-01T00:00:00.000Z"),
      remainingUsdMicros: 4_500_000n,
      spentUsdMicros: 0n,
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ok: true,
      reason: "sent-daily-quota-reply",
    });
    expect(plan.desiredSideEffects).toHaveLength(1);
    expect(plan.desiredSideEffects[0]?.payload).toMatchObject({
      chatId: "chat_group_123",
      memberId: "member_thread_container_123",
      routeAuthority: {
        accountLookupKey: createHostedPhoneLookupKey("+15550000000"),
        channel: "linq",
        containerMemberId: "member_thread_container_123",
        threadId: "chat_group_123",
      },
      template: "daily_quota",
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("uses the existing AI usage notice behavior for routed thread traffic", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
    });
    const periodStart = new Date("2026-06-01T00:00:00.000Z");
    vi.mocked(mailboxStore.readHostedMailboxItemByDedupeKey).mockResolvedValueOnce(null);
    vi.mocked(linqDailyState.incrementHostedLinqInboundDailyState).mockResolvedValueOnce({
      dayUtc: new Date("2026-06-24T00:00:00.000Z"),
      inboundCount: 1,
      memberId: "member_thread_container_123",
      outboundCount: 0,
      quotaReplySentAt: null,
    } as Awaited<ReturnType<typeof linqDailyState.incrementHostedLinqInboundDailyState>>);
    vi.mocked(usageAllowance.checkHostedAiUsageGate).mockResolvedValueOnce({
      allowed: false,
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 4_500_000n,
      memberId: "member_thread_container_123",
      periodEnd: new Date("2026-07-01T00:00:00.000Z"),
      periodStart,
      reason: "ai_usage_limit_exceeded",
      remainingUsdMicros: 0n,
      retryAfter: new Date("2026-07-01T00:00:00.000Z"),
      spentUsdMicros: 4_500_000n,
      userNotice: {
        code: "edge_usage_limit_reached",
        message: "Usage limit reached.",
      },
    });
    vi.mocked(usageAllowance.claimHostedAiUsageLimitNotice).mockResolvedValueOnce(true);

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ok: true,
      reason: "sent-ai-usage-quota-reply",
    });
    expect(plan.desiredSideEffects).toHaveLength(1);
    expect(plan.desiredSideEffects[0]?.payload).toMatchObject({
      chatId: "chat_group_123",
      memberId: "member_thread_container_123",
      message: "Usage limit reached.",
      noticeCode: "edge_usage_limit_reached",
      routeAuthority: {
        accountLookupKey: createHostedPhoneLookupKey("+15550000000"),
        channel: "linq",
        containerMemberId: "member_thread_container_123",
        threadId: "chat_group_123",
      },
      template: "ai_usage_quota",
    });
    expect(usageAllowance.claimHostedAiUsageLimitNotice).toHaveBeenCalledWith({
      memberId: "member_thread_container_123",
      periodStart,
      prisma,
      sentAt: expect.any(Date),
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("still ignores unbound Linq group threads", async () => {
    const prisma = createPrisma();

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "group-chat",
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("ignores routed thread traffic when the container is inactive", async () => {
    const prisma = createPrisma({
      routeContainerActive: false,
      routeContainerMemberId: "member_thread_container_123",
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "thread-container-inactive",
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("ignores routed thread traffic when the route owner is inactive", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
      routeOwnerActive: false,
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "thread-container-inactive",
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("fails closed for an inactive routed direct thread instead of normal Linq routing", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
      routeOwnerActive: false,
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({
        isGroup: false,
      }),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "thread-container-inactive",
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.updateMany).not.toHaveBeenCalled();
  });

  it("dedupes routed thread webhooks against the container mailbox", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
    });
    vi.mocked(mailboxStore.readHostedMailboxItemByDedupeKey).mockResolvedValueOnce(
      buildHostedMailboxItem({
        id: "mailbox_existing",
        userId: "member_thread_container_123",
      }),
    );

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      duplicate: true,
      ignored: true,
      ok: true,
      reason: "duplicate-webhook-event",
    });
    expect(plan.wakeMailboxItemId).toBe("mailbox_existing");
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });
});
