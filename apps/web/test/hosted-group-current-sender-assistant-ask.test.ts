import { beforeEach, describe, expect, it, vi } from "vitest";

import { createHash } from "node:crypto";

import {
  createHostedExecutionPrivateAssistantAskCompletionDeliveryKey,
  createHostedExecutionReviewedAssistantAskCompletionDeliveryKey,
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionTelegramConversationMessageWake,
  HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
} from "@murphai/hosted-execution";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeTx: vi.fn(),
  appendHostedMailboxEnvelopeWithIdentityTx: vi.fn(),
  assertHostedLinqRouteEgressAuthority: vi.fn(),
  assertHostedThreadRouteEgressAuthority: vi.fn(),
  hostedThreadContainerFindUnique: vi.fn(),
  lookupHostedGroupParticipantMemberByHandle: vi.fn(),
  readHostedGroupDisclosureGrantAuthorityTx: vi.fn(),
  readHostedMailboxConversationWakeByAssistantInputId: vi.fn(),
  readHostedMailboxItemByDedupeKey: vi.fn(),
  readHostedMailboxItemById: vi.fn(),
  readHostedMailboxWakeByDedupeKey: vi.fn(),
  readHostedMailboxWakeByItemId: vi.fn(),
  requireHostedRuntimeActiveAccess: vi.fn(),
  requireHostedRuntimeActiveAccessForUpdateTx: vi.fn(),
  resolveHostedAssistantNotificationDestination: vi.fn(),
  resolveHostedMemberRoutingByTelegramUserId: vi.fn(),
}));

const fakeTx = {
  $executeRaw: vi.fn(async () => 0),
  hostedThreadContainer: {
    findUnique: mocks.hostedThreadContainerFindUnique,
  },
};

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
  appendHostedMailboxEnvelopeWithIdentityTx:
    mocks.appendHostedMailboxEnvelopeWithIdentityTx,
  readHostedMailboxConversationWakeByAssistantInputId:
    mocks.readHostedMailboxConversationWakeByAssistantInputId,
  readHostedMailboxItemByDedupeKey: mocks.readHostedMailboxItemByDedupeKey,
  readHostedMailboxItemById: mocks.readHostedMailboxItemById,
  readHostedMailboxWakeByDedupeKey: mocks.readHostedMailboxWakeByDedupeKey,
  readHostedMailboxWakeByItemId: mocks.readHostedMailboxWakeByItemId,
}));

vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({
  requireHostedRuntimeActiveAccess: mocks.requireHostedRuntimeActiveAccess,
  requireHostedRuntimeActiveAccessForUpdateTx:
    mocks.requireHostedRuntimeActiveAccessForUpdateTx,
}));

vi.mock("@/src/lib/hosted-onboarding/errors", () => ({
  hostedOnboardingError: (input: {
    code: string;
    httpStatus: number;
    message: string;
    retryable: boolean;
  }) => Object.assign(new Error(input.message), input),
  isHostedOnboardingError: (error: unknown) => Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && "retryable" in error
  ),
}));

vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  assertHostedLinqRouteEgressAuthority:
    mocks.assertHostedLinqRouteEgressAuthority,
  assertHostedThreadRouteEgressAuthority:
    mocks.assertHostedThreadRouteEgressAuthority,
}));

vi.mock("@/src/lib/hosted-routing/assistant-notification-destination", () => ({
  resolveHostedAssistantNotificationDestination:
    mocks.resolveHostedAssistantNotificationDestination,
}));

vi.mock("@/src/lib/hosted-groups/group-disclosure-store", () => ({
  readHostedGroupDisclosureGrantAuthorityTx:
    mocks.readHostedGroupDisclosureGrantAuthorityTx,
}));

vi.mock("@/src/lib/hosted-groups/participant-member", () => ({
  lookupHostedGroupParticipantMemberByHandle:
    mocks.lookupHostedGroupParticipantMemberByHandle,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  resolveHostedMemberRoutingByTelegramUserId:
    mocks.resolveHostedMemberRoutingByTelegramUserId,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({
    $transaction: (run: (tx: typeof fakeTx) => Promise<unknown>) => run(fakeTx),
  }),
}));

import {
  assertHostedAssistantAskCompletionDeliveryAuthorityTx,
  createHostedAssistantAskCompletionId,
  handleHostedRuntimeAssistantAskControl,
} from "@/src/lib/hosted-groups/group-assistant-ask";
import {
  HOSTED_GROUP_CURRENT_SENDER_DISCLOSURE_PERMISSION_TEXT,
  HOSTED_GROUP_CURRENT_SENDER_PRIVATE_PERMISSION_TEXT,
  assertHostedGroupCurrentSenderPrivateCompletionDeliveryAuthorityTx,
  createHostedGroupCurrentSenderAssistantAskRequestId,
  createHostedGroupCurrentSenderPrivateAssistantAskRequestId,
  requestHostedGroupCurrentSenderAssistantAsk,
  requestHostedGroupCurrentSenderPrivateAssistantAsk,
} from "@/src/lib/hosted-groups/group-current-sender-assistant-ask";
import {
  createHostedGroupCurrentSenderDailyMetricReportId,
  recordHostedGroupCurrentSenderDailyMetric,
} from "@/src/lib/hosted-groups/group-current-sender-daily-metric";

const GROUP_RUNTIME_MEMBER_ID = "member_group_runtime";
const SENDER_MEMBER_ID = "member_sender";
const ORIGIN_ASSISTANT_INPUT_ID = `ain_${"a".repeat(32)}`;
const NOW = new Date("2026-07-27T20:00:00.000Z");
const ROUTE_AUTHORITY = {
  accountLookupKey: "hplk_line",
  channel: "linq" as const,
  containerMemberId: GROUP_RUNTIME_MEMBER_ID,
  threadId: "chat_group",
};
const DIRECT_ROUTE = {
  actorId: null,
  channel: "linq" as const,
  delivery: {
    kind: "thread" as const,
    target: "linq_private_thread",
  },
  identityId: `hid_${"1".repeat(32)}`,
  threadId: `hid_${"2".repeat(32)}`,
  threadIsDirect: true,
};
const LINQ_PARTICIPANT_ROUTE = {
  actorId: `hid_${"3".repeat(32)}`,
  channel: "linq" as const,
  delivery: {
    kind: "participant" as const,
    source: {
      fromPhoneNumber: "+15550001002",
      kind: "linq" as const,
    },
    target: "+15550001001",
  },
  identityId: `hid_${"4".repeat(32)}`,
  threadId: null,
  threadIsDirect: true,
};
const CURRENT_SENDER_ORIGIN = {
  assistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
  kind: "accepted_input" as const,
  sessionId: "session_group",
};

function createSourceWake(input: {
  senderMemberId?: string;
  text?: string;
} = {}) {
  return buildHostedExecutionLinqConversationMessageWake({
    eventId: "source_event",
    linqMessage: {
      chatId: "chat_group",
      from: "+15550000001",
      isFromMe: false,
      messageId: "message_group",
      parts: [{ type: "text", value: input.text ?? "Murph tell them about my sleep" }],
      service: "imessage",
      threadIsDirect: false,
    },
    occurredAt: "2026-07-27T19:59:59.000Z",
    phoneLookupKey: "hplk_sender",
    routeAuthority: ROUTE_AUTHORITY,
    ...(input.senderMemberId === undefined
      ? {}
      : { senderMemberId: input.senderMemberId }),
    userId: GROUP_RUNTIME_MEMBER_ID,
  });
}

function createTelegramSourceWake() {
  return buildHostedExecutionTelegramConversationMessageWake({
    eventId: "source_telegram_event",
    occurredAt: "2026-07-27T19:59:59.000Z",
    routeAuthority: {
      channel: "telegram",
      containerMemberId: GROUP_RUNTIME_MEMBER_ID,
      threadId: "telegram_group",
    },
    telegramMessage: {
      from: "123456789",
      messageId: "42",
      schema: HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
      text: "Murph tell them about my recovery",
      threadId: "telegram_group",
      threadIsDirect: false,
    },
    userId: GROUP_RUNTIME_MEMBER_ID,
  });
}

function activeContainerLookup(input: { where?: { memberId?: string } }) {
  return input.where?.memberId === GROUP_RUNTIME_MEMBER_ID
    ? { memberId: GROUP_RUNTIME_MEMBER_ID }
    : null;
}

type CurrentSenderSourceWake =
  | ReturnType<typeof createSourceWake>
  | ReturnType<typeof createTelegramSourceWake>;

async function createCurrentSenderRequestFixture(
  sourceWake: CurrentSenderSourceWake,
) {
  mocks.readHostedMailboxConversationWakeByAssistantInputId.mockImplementation(
    async ({ assistantInputId, memberId }: {
      assistantInputId: string;
      memberId: string;
    }) => assistantInputId === ORIGIN_ASSISTANT_INPUT_ID
      && memberId === GROUP_RUNTIME_MEMBER_ID
        ? sourceWake
        : null,
  );
  const admission = await requestHostedGroupCurrentSenderAssistantAsk({
    groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
    now: NOW,
    origin: CURRENT_SENDER_ORIGIN,
  });
  const requestId = createHostedGroupCurrentSenderAssistantAskRequestId({
    groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
    originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
  });
  const requestWake =
    mocks.appendHostedMailboxEnvelopeWithIdentityTx.mock.calls[0]?.[0].envelope;
  if (!requestWake) {
    throw new Error("Expected current-sender Assistant Ask request append.");
  }
  mocks.readHostedMailboxItemById.mockImplementation(
    async ({ mailboxItemId }: { mailboxItemId: string }) =>
      mailboxItemId === requestId
        ? {
            dedupeKey: requestId,
            expiresAt: requestWake.ask.expiresAt,
            id: requestId,
            kind: "assistant.ask.requested",
            userId: requestWake.userId,
          }
        : null,
  );
  mocks.readHostedMailboxWakeByItemId.mockImplementation(
    async ({ mailboxItemId }: { mailboxItemId: string }) =>
      mailboxItemId === requestId ? requestWake : null,
  );
  return { admission, requestId, requestWake };
}

describe("hosted current-sender Assistant Ask authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hostedThreadContainerFindUnique.mockImplementation(activeContainerLookup);
    mocks.readHostedMailboxConversationWakeByAssistantInputId.mockResolvedValue(
      createSourceWake(),
    );
    mocks.lookupHostedGroupParticipantMemberByHandle.mockResolvedValue({
      core: { id: SENDER_MEMBER_ID },
    });
    mocks.resolveHostedMemberRoutingByTelegramUserId.mockResolvedValue({
      lookup: { core: { id: SENDER_MEMBER_ID } },
      status: "found",
    });
    mocks.readHostedMailboxItemById.mockResolvedValue(null);
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValue(null);
    mocks.readHostedMailboxWakeByDedupeKey.mockResolvedValue(null);
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue(null);
    mocks.requireHostedRuntimeActiveAccess.mockResolvedValue(undefined);
    mocks.requireHostedRuntimeActiveAccessForUpdateTx.mockResolvedValue(undefined);
    mocks.resolveHostedAssistantNotificationDestination.mockResolvedValue({
      conversationShape: "direct-member",
      externalThreadRouteAuthority: null,
      route: DIRECT_ROUTE,
    });
    mocks.assertHostedLinqRouteEgressAuthority.mockResolvedValue(undefined);
    mocks.assertHostedThreadRouteEgressAuthority.mockResolvedValue(undefined);
    mocks.readHostedGroupDisclosureGrantAuthorityTx.mockResolvedValue(null);
    mocks.appendHostedMailboxEnvelopeWithIdentityTx.mockImplementation(
      async (input: { envelope: { eventId: string }; itemId: string }) => ({
        dedupeConflict: false,
        item: { id: input.itemId },
      }),
    );
    mocks.appendHostedMailboxEnvelopeTx.mockImplementation(
      async (input: { envelope: { eventId: string } }) => ({
        dedupeConflict: false,
        item: { id: `item_${input.envelope.eventId}` },
      }),
    );
  });

  it("durably admits an exact sender's daily metric report and rejects changed replay", async () => {
    const dailyMetric = {
      date: "2026-07-27",
      metric: "steps",
      unit: "count",
      value: 8_000,
    };
    const reportId = createHostedGroupCurrentSenderDailyMetricReportId({
      date: dailyMetric.date,
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      metric: dailyMetric.metric,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
    });

    const admission = await recordHostedGroupCurrentSenderDailyMetric({
      dailyMetric,
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      now: NOW,
      origin: CURRENT_SENDER_ORIGIN,
    });

    expect(admission).toEqual({
      mailboxWake: {
        expectedUserId: SENDER_MEMBER_ID,
        mailboxItemId: `item_${reportId}`,
      },
      result: { status: "accepted" },
    });
    const appendedWake = mocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0]
      .envelope;
    expect(appendedWake).toEqual({
      dailyMetric,
      eventId: reportId,
      kind: "health.daily-metric.reported",
      occurredAt: NOW.toISOString(),
      userId: SENDER_MEMBER_ID,
    });

    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValue({
      id: `item_${reportId}`,
    });
    mocks.readHostedMailboxWakeByDedupeKey.mockResolvedValue(appendedWake);
    await expect(recordHostedGroupCurrentSenderDailyMetric({
      dailyMetric,
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      now: NOW,
      origin: CURRENT_SENDER_ORIGIN,
    })).resolves.toEqual(admission);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);

    await expect(recordHostedGroupCurrentSenderDailyMetric({
      dailyMetric: { ...dailyMetric, value: 9_000 },
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      now: NOW,
      origin: CURRENT_SENDER_ORIGIN,
    })).resolves.toEqual({
      mailboxWake: null,
      result: { status: "unavailable", unavailableReason: "report_conflict" },
    });
  });

  it("derives sender, exact question, route, and reviewed authority from one stored input", async () => {
    const origin = {
      assistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      kind: "accepted_input" as const,
      sessionId: "session_group",
    };
    const admission = await requestHostedGroupCurrentSenderAssistantAsk({
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      now: NOW,
      origin,
    });

    const requestId = createHostedGroupCurrentSenderAssistantAskRequestId({
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
    });
    expect(admission).toEqual({
      mailboxWake: {
        expectedUserId: SENDER_MEMBER_ID,
        mailboxItemId: requestId,
      },
      result: { status: "accepted" },
    });
    expect(
      mocks.readHostedMailboxConversationWakeByAssistantInputId,
    ).toHaveBeenCalledWith({
      assistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      availableAt: NOW,
      memberId: GROUP_RUNTIME_MEMBER_ID,
      prisma: fakeTx,
    });
    expect(mocks.assertHostedThreadRouteEgressAuthority).toHaveBeenCalledWith({
      authority: ROUTE_AUTHORITY,
      prisma: fakeTx,
    });
    expect(
      mocks.lookupHostedGroupParticipantMemberByHandle,
    ).toHaveBeenCalledWith({
      handle: "+15550000001",
      prisma: fakeTx,
    });

    const appendInput = mocks.appendHostedMailboxEnvelopeWithIdentityTx.mock.calls[0]?.[0];
    expect(appendInput).toMatchObject({
      itemId: requestId,
      envelope: {
        ask: {
          origin,
          question: "Murph tell them about my sleep",
          target: {
            groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
            kind: "group_sender",
          },
        },
        eventId: requestId,
        kind: "assistant.ask.requested",
        userId: SENDER_MEMBER_ID,
      },
    });
    const requestWake = appendInput.envelope;
    expect(requestWake.ask.target.permissionDigest).toMatch(/^[a-f0-9]{64}$/u);

    mocks.readHostedMailboxItemById.mockImplementation(
      async ({ mailboxItemId }: { mailboxItemId: string }) =>
        mailboxItemId === requestId
          ? {
              dedupeKey: requestId,
              expiresAt: requestWake.ask.expiresAt,
              id: requestId,
              kind: "assistant.ask.requested",
              userId: SENDER_MEMBER_ID,
            }
          : null,
    );
    mocks.readHostedMailboxWakeByItemId.mockImplementation(
      async ({ mailboxItemId }: { mailboxItemId: string }) =>
        mailboxItemId === requestId ? requestWake : null,
    );

    await expect(requestHostedGroupCurrentSenderAssistantAsk({
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      now: NOW,
      origin,
    })).resolves.toEqual(admission);
    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).toHaveBeenCalledTimes(1);
    await expect(requestHostedGroupCurrentSenderAssistantAsk({
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      now: NOW,
      origin: { ...origin, sessionId: "different_session" },
    })).resolves.toEqual({
      mailboxWake: null,
      result: {
        status: "unavailable",
        unavailableReason: "request_conflict",
      },
    });

    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: SENDER_MEMBER_ID,
      now: NOW,
      request: { action: "prepare", requestId },
    })).resolves.toEqual({
      mailboxWake: null,
      response: {
        action: "prepare",
        disclosure: {
          permissionText: HOSTED_GROUP_CURRENT_SENDER_DISCLOSURE_PERMISSION_TEXT,
        },
        question: "Murph tell them about my sleep",
        status: "ready",
        targetLabel: null,
      },
    });

    const completionId = createHostedAssistantAskCompletionId(requestId);
    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: SENDER_MEMBER_ID,
      now: NOW,
      request: {
        action: "complete",
        requestId,
        result: {
          answer: "Your recent sleep has been inconsistent.",
          outcome: "answered",
        },
      },
    })).resolves.toEqual({
      mailboxWake: {
        expectedUserId: GROUP_RUNTIME_MEMBER_ID,
        mailboxItemId: completionId,
      },
      response: { action: "complete", status: "completed" },
    });
    const completionWake =
      mocks.appendHostedMailboxEnvelopeWithIdentityTx.mock.calls[1]?.[0].envelope;
    mocks.readHostedMailboxItemById.mockImplementation(
      async ({ mailboxItemId }: { mailboxItemId: string }) =>
        mailboxItemId === requestId
          ? {
              dedupeKey: requestId,
              expiresAt: requestWake.ask.expiresAt,
              id: requestId,
              kind: "assistant.ask.requested",
              userId: SENDER_MEMBER_ID,
            }
          : mailboxItemId === completionId
            ? {
                dedupeKey: completionId,
                expiresAt: requestWake.ask.expiresAt,
                id: completionId,
                kind: "assistant.ask.completed",
                userId: GROUP_RUNTIME_MEMBER_ID,
              }
            : null,
    );
    mocks.readHostedMailboxWakeByItemId.mockImplementation(
      async ({ mailboxItemId }: { mailboxItemId: string }) =>
        mailboxItemId === requestId
          ? requestWake
          : mailboxItemId === completionId
            ? completionWake
            : null,
    );
    await expect(assertHostedAssistantAskCompletionDeliveryAuthorityTx({
      answeredMailboxItemIds: [completionId],
      boundRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      idempotencyKey:
        createHostedExecutionReviewedAssistantAskCompletionDeliveryKey(
          completionId,
        ),
      now: NOW,
      tx: fakeTx as never,
    })).resolves.toBeUndefined();
  });

  it("queues and replays one private current-sender completion on the sender personal runtime", async () => {
    const question = "Murph text me privately about my sleep";
    const answer = "Your recent sleep has been inconsistent.";
    mocks.readHostedMailboxConversationWakeByAssistantInputId.mockResolvedValue(
      createSourceWake({ text: question }),
    );

    const admission = await requestHostedGroupCurrentSenderPrivateAssistantAsk({
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      now: NOW,
      origin: CURRENT_SENDER_ORIGIN,
    });
    const requestId =
      createHostedGroupCurrentSenderPrivateAssistantAskRequestId({
        groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
        originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      });
    expect(requestId).not.toBe(createHostedGroupCurrentSenderAssistantAskRequestId({
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
    }));
    expect(admission).toEqual({
      mailboxWake: {
        expectedUserId: SENDER_MEMBER_ID,
        mailboxItemId: requestId,
      },
      result: { status: "accepted" },
    });

    const requestWake =
      mocks.appendHostedMailboxEnvelopeWithIdentityTx.mock.calls[0]?.[0].envelope;
    if (!requestWake) {
      throw new Error("Expected private current-sender Assistant Ask request append.");
    }
    expect(requestWake).toMatchObject({
      ask: {
        origin: CURRENT_SENDER_ORIGIN,
        question,
        target: {
          groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
          kind: "group_sender_private",
        },
      },
      eventId: requestId,
      kind: "assistant.ask.requested",
      userId: SENDER_MEMBER_ID,
    });
    expect(requestWake.ask.target.permissionDigest).toMatch(/^[a-f0-9]{64}$/u);

    mocks.readHostedMailboxItemById.mockImplementation(
      async ({ mailboxItemId }: { mailboxItemId: string }) =>
        mailboxItemId === requestId
          ? {
              dedupeKey: requestId,
              expiresAt: requestWake.ask.expiresAt,
              id: requestId,
              kind: "assistant.ask.requested",
              userId: SENDER_MEMBER_ID,
            }
          : null,
    );
    mocks.readHostedMailboxWakeByItemId.mockImplementation(
      async ({ mailboxItemId }: { mailboxItemId: string }) =>
        mailboxItemId === requestId ? requestWake : null,
    );

    await expect(requestHostedGroupCurrentSenderPrivateAssistantAsk({
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      now: NOW,
      origin: CURRENT_SENDER_ORIGIN,
    })).resolves.toEqual(admission);
    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).toHaveBeenCalledTimes(1);

    mocks.resolveHostedAssistantNotificationDestination.mockResolvedValueOnce({
      conversationShape: "direct-member",
      externalThreadRouteAuthority: null,
      route: LINQ_PARTICIPANT_ROUTE,
    });
    await expect(requestHostedGroupCurrentSenderPrivateAssistantAsk({
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      now: NOW,
      origin: CURRENT_SENDER_ORIGIN,
    })).resolves.toEqual({
      mailboxWake: null,
      result: {
        status: "unavailable",
        unavailableReason: "same_channel_direct_route_unavailable",
      },
    });
    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).toHaveBeenCalledTimes(1);

    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: SENDER_MEMBER_ID,
      now: NOW,
      request: { action: "prepare", requestId },
    })).resolves.toEqual({
      mailboxWake: null,
      response: {
        action: "prepare",
        disclosure: {
          permissionText: HOSTED_GROUP_CURRENT_SENDER_PRIVATE_PERMISSION_TEXT,
        },
        question,
        status: "ready",
        targetLabel: null,
      },
    });

    const completionId = createHostedAssistantAskCompletionId(requestId);
    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: SENDER_MEMBER_ID,
      now: NOW,
      request: {
        action: "complete",
        requestId,
        result: { answer, outcome: "answered" },
      },
    })).resolves.toEqual({
      mailboxWake: {
        expectedUserId: SENDER_MEMBER_ID,
        mailboxItemId: completionId,
      },
      response: { action: "complete", status: "completed" },
    });

    const completionAppend =
      mocks.appendHostedMailboxEnvelopeWithIdentityTx.mock.calls[1]?.[0];
    expect(completionAppend).toMatchObject({
      envelope: {
        eventId: completionId,
        kind: "assistant.notification.requested",
        notification: {
          deliveryDedupeToken: `assistant-ask-private:${completionId}`,
          deliveryDispatchMode: "queue-only",
          deliveryIdempotencyKey: `assistant-ask-private:${completionId}`,
          externalThreadRouteAuthority: null,
          responsePolicy: {
            kind: "require_send_exact_text",
            text: answer,
          },
          route: DIRECT_ROUTE,
        },
        userId: SENDER_MEMBER_ID,
      },
      expiresAt: requestWake.ask.expiresAt,
      itemId: completionId,
      tx: fakeTx,
    });
    expect(
      mocks.resolveHostedAssistantNotificationDestination,
    ).toHaveBeenCalledWith({
      directChannel: "linq",
      memberId: SENDER_MEMBER_ID,
      prisma: fakeTx,
    });

    const completionWake = completionAppend?.envelope;
    if (!completionWake) {
      throw new Error("Expected private current-sender notification append.");
    }
    mocks.readHostedMailboxItemById.mockImplementation(
      async ({ mailboxItemId }: { mailboxItemId: string }) =>
        mailboxItemId === requestId
          ? {
              dedupeKey: requestId,
              expiresAt: requestWake.ask.expiresAt,
              id: requestId,
              kind: "assistant.ask.requested",
              userId: SENDER_MEMBER_ID,
            }
          : mailboxItemId === completionId
            ? {
                dedupeKey: completionId,
                expiresAt: requestWake.ask.expiresAt,
                id: completionId,
                kind: "assistant.notification.requested",
                userId: SENDER_MEMBER_ID,
              }
            : null,
    );
    mocks.readHostedMailboxWakeByItemId.mockImplementation(
      async ({ mailboxItemId }: { mailboxItemId: string }) =>
        mailboxItemId === requestId
          ? requestWake
          : mailboxItemId === completionId
            ? completionWake
            : null,
    );

    const privateDeliveryAuthority = {
      answeredMailboxItemIds: [completionId],
      assistantAskCompletionExpiresAt: requestWake.ask.expiresAt,
      boundRuntimeMemberId: SENDER_MEMBER_ID,
      idempotencyKey:
        createHostedExecutionPrivateAssistantAskCompletionDeliveryKey(
          completionId,
        ),
      now: NOW,
      responseTextDigest: createHash("sha256").update(answer).digest("hex"),
      route: DIRECT_ROUTE,
      tx: fakeTx as never,
    };
    await expect(
      assertHostedGroupCurrentSenderPrivateCompletionDeliveryAuthorityTx(
        privateDeliveryAuthority,
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertHostedGroupCurrentSenderPrivateCompletionDeliveryAuthorityTx({
        ...privateDeliveryAuthority,
        responseTextDigest: "0".repeat(64),
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_ASSISTANT_ASK_DELIVERY_AUTHORITY_MISMATCH",
    });
    await expect(
      assertHostedGroupCurrentSenderPrivateCompletionDeliveryAuthorityTx({
        ...privateDeliveryAuthority,
        now: new Date(requestWake.ask.expiresAt),
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_ASSISTANT_ASK_DELIVERY_AUTHORITY_MISMATCH",
    });
    await expect(
      assertHostedGroupCurrentSenderPrivateCompletionDeliveryAuthorityTx({
        ...privateDeliveryAuthority,
        route: {
          ...DIRECT_ROUTE,
          threadId: `hid_${"3".repeat(32)}`,
        },
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_ASSISTANT_ASK_DELIVERY_AUTHORITY_MISMATCH",
    });
    await expect(
      assertHostedGroupCurrentSenderPrivateCompletionDeliveryAuthorityTx({
        ...privateDeliveryAuthority,
        boundRuntimeMemberId: "member_other",
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_ASSISTANT_ASK_DELIVERY_AUTHORITY_MISMATCH",
    });

    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: SENDER_MEMBER_ID,
      now: NOW,
      request: {
        action: "complete",
        requestId,
        result: {
          answer: "A retry must not replace the reviewed answer.",
          outcome: "answered",
        },
      },
    })).resolves.toEqual({
      mailboxWake: {
        expectedUserId: SENDER_MEMBER_ID,
        mailboxItemId: completionId,
      },
      response: { action: "complete", status: "already_completed" },
    });
    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).toHaveBeenCalledTimes(2);
    expect(completionWake.notification.responsePolicy).toEqual({
      kind: "require_send_exact_text",
      text: answer,
    });

    mocks.resolveHostedAssistantNotificationDestination.mockResolvedValue({
      conversationShape: "direct-member",
      externalThreadRouteAuthority: null,
      route: {
        ...DIRECT_ROUTE,
        threadId: `hid_${"3".repeat(32)}`,
      },
    });
    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: SENDER_MEMBER_ID,
      now: NOW,
      request: {
        action: "complete",
        requestId,
        result: { answer, outcome: "answered" },
      },
    })).resolves.toEqual({
      mailboxWake: null,
      response: {
        action: "complete",
        status: "terminal",
        terminalReason: "unavailable",
      },
    });
    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).toHaveBeenCalledTimes(2);
  });

  it("rejects a Linq participant fallback before personal work", async () => {
    mocks.resolveHostedAssistantNotificationDestination.mockResolvedValue({
      conversationShape: "direct-member",
      externalThreadRouteAuthority: null,
      route: LINQ_PARTICIPANT_ROUTE,
    });

    await expect(requestHostedGroupCurrentSenderPrivateAssistantAsk({
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      now: NOW,
      origin: CURRENT_SENDER_ORIGIN,
    })).resolves.toEqual({
      mailboxWake: null,
      result: {
        status: "unavailable",
        unavailableReason: "same_channel_direct_route_unavailable",
      },
    });

    expect(
      mocks.resolveHostedAssistantNotificationDestination,
    ).toHaveBeenCalledWith({
      directChannel: "linq",
      memberId: SENDER_MEMBER_ID,
      prisma: fakeTx,
    });
    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).not.toHaveBeenCalled();
  });

  it("rejects a Telegram group sender without a direct chat before personal work", async () => {
    mocks.readHostedMailboxConversationWakeByAssistantInputId.mockResolvedValue(
      createTelegramSourceWake(),
    );
    mocks.resolveHostedAssistantNotificationDestination.mockResolvedValue(null);

    await expect(requestHostedGroupCurrentSenderPrivateAssistantAsk({
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      now: NOW,
      origin: CURRENT_SENDER_ORIGIN,
    })).resolves.toEqual({
      mailboxWake: null,
      result: {
        status: "unavailable",
        unavailableReason: "same_channel_direct_route_unavailable",
      },
    });

    expect(
      mocks.resolveHostedAssistantNotificationDestination,
    ).toHaveBeenCalledWith({
      directChannel: "telegram",
      memberId: SENDER_MEMBER_ID,
      prisma: fakeTx,
    });
    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).not.toHaveBeenCalled();
  });

  it("rejects replay at the exact expiry boundary without another wake", async () => {
    const requested = await createCurrentSenderRequestFixture(createSourceWake());
    expect(requested.requestWake.ask.expiresAt).toBe(
      "2026-07-27T20:10:00.000Z",
    );

    mocks.appendHostedMailboxEnvelopeWithIdentityTx.mockClear();
    mocks.readHostedMailboxConversationWakeByAssistantInputId.mockClear();
    mocks.readHostedMailboxWakeByItemId.mockClear();
    mocks.requireHostedRuntimeActiveAccessForUpdateTx.mockClear();
    mocks.assertHostedThreadRouteEgressAuthority.mockClear();
    mocks.lookupHostedGroupParticipantMemberByHandle.mockClear();

    await expect(requestHostedGroupCurrentSenderAssistantAsk({
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      now: new Date(requested.requestWake.ask.expiresAt),
      origin: CURRENT_SENDER_ORIGIN,
    })).resolves.toEqual({
      mailboxWake: null,
      result: {
        status: "unavailable",
        unavailableReason: "request_expired",
      },
    });
    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).not.toHaveBeenCalled();
    expect(mocks.readHostedMailboxWakeByItemId).not.toHaveBeenCalled();
    expect(
      mocks.readHostedMailboxConversationWakeByAssistantInputId,
    ).not.toHaveBeenCalled();
    expect(
      mocks.requireHostedRuntimeActiveAccessForUpdateTx,
    ).not.toHaveBeenCalled();
    expect(mocks.assertHostedThreadRouteEgressAuthority).not.toHaveBeenCalled();
    expect(
      mocks.lookupHostedGroupParticipantMemberByHandle,
    ).not.toHaveBeenCalled();
  });

  it("carries Telegram through prepare, completion, and final authorization, then falls back after sender rebinding", async () => {
    const requested = await createCurrentSenderRequestFixture(
      createTelegramSourceWake(),
    );
    expect(requested.admission).toEqual({
      mailboxWake: {
        expectedUserId: SENDER_MEMBER_ID,
        mailboxItemId: requested.requestId,
      },
      result: { status: "accepted" },
    });
    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: SENDER_MEMBER_ID,
      now: NOW,
      request: { action: "prepare", requestId: requested.requestId },
    })).resolves.toEqual({
      mailboxWake: null,
      response: {
        action: "prepare",
        disclosure: {
          permissionText: HOSTED_GROUP_CURRENT_SENDER_DISCLOSURE_PERMISSION_TEXT,
        },
        question: "Murph tell them about my recovery",
        status: "ready",
        targetLabel: null,
      },
    });

    const completionId = createHostedAssistantAskCompletionId(
      requested.requestId,
    );
    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: SENDER_MEMBER_ID,
      now: NOW,
      request: {
        action: "complete",
        requestId: requested.requestId,
        result: {
          answer: "Your recent recovery has been inconsistent.",
          outcome: "answered",
        },
      },
    })).resolves.toEqual({
      mailboxWake: {
        expectedUserId: GROUP_RUNTIME_MEMBER_ID,
        mailboxItemId: completionId,
      },
      response: { action: "complete", status: "completed" },
    });
    const completionWake =
      mocks.appendHostedMailboxEnvelopeWithIdentityTx.mock.calls[1]?.[0].envelope;
    if (!completionWake) {
      throw new Error("Expected current-sender Assistant Ask completion append.");
    }
    mocks.readHostedMailboxItemById.mockImplementation(
      async ({ mailboxItemId }: { mailboxItemId: string }) =>
        mailboxItemId === requested.requestId
          ? {
              dedupeKey: requested.requestId,
              expiresAt: requested.requestWake.ask.expiresAt,
              id: requested.requestId,
              kind: "assistant.ask.requested",
              userId: requested.requestWake.userId,
            }
          : mailboxItemId === completionId
            ? {
                dedupeKey: completionId,
                expiresAt: completionWake.ask.expiresAt,
                id: completionId,
                kind: "assistant.ask.completed",
                userId: completionWake.userId,
              }
            : null,
    );
    mocks.readHostedMailboxWakeByItemId.mockImplementation(
      async ({ mailboxItemId }: { mailboxItemId: string }) =>
        mailboxItemId === requested.requestId ? requested.requestWake : null,
    );
    mocks.readHostedMailboxWakeByDedupeKey.mockImplementation(
      async ({ dedupeKey }: { dedupeKey: string }) =>
        dedupeKey === completionId ? completionWake : null,
    );
    const deliveryInput = {
      answeredMailboxItemIds: [completionId],
      assistantAskCompletionExpiresAt: completionWake.ask.expiresAt,
      boundRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      idempotencyKey:
        createHostedExecutionReviewedAssistantAskCompletionDeliveryKey(
          completionId,
        ),
      now: NOW,
      tx: fakeTx as never,
    };

    await expect(assertHostedAssistantAskCompletionDeliveryAuthorityTx({
      ...deliveryInput,
      assistantAskFallback: false,
    })).resolves.toBeUndefined();
    expect(
      mocks.readHostedMailboxConversationWakeByAssistantInputId,
    ).toHaveBeenLastCalledWith({
      assistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      availableAt: NOW,
      memberId: GROUP_RUNTIME_MEMBER_ID,
      prisma: fakeTx,
    });
    expect(
      mocks.resolveHostedMemberRoutingByTelegramUserId,
    ).toHaveBeenCalledTimes(4);
    expect(
      mocks.resolveHostedMemberRoutingByTelegramUserId,
    ).toHaveBeenLastCalledWith({
      prisma: fakeTx,
      telegramUserId: "123456789",
    });

    mocks.resolveHostedMemberRoutingByTelegramUserId.mockResolvedValue({
      lookup: { core: { id: "member_rebound_sender" } },
      status: "found",
    });
    await expect(assertHostedAssistantAskCompletionDeliveryAuthorityTx({
      ...deliveryInput,
      assistantAskFallback: false,
    })).resolves.toEqual({ assistantAskFallbackRequired: true });
    await expect(assertHostedAssistantAskCompletionDeliveryAuthorityTx({
      ...deliveryInput,
      assistantAskFallback: true,
    })).resolves.toBeUndefined();
    expect(
      mocks.resolveHostedMemberRoutingByTelegramUserId,
    ).toHaveBeenCalledTimes(5);
    expect(mocks.assertHostedThreadRouteEgressAuthority).toHaveBeenCalledTimes(5);
    expect(mocks.assertHostedThreadRouteEgressAuthority).toHaveBeenLastCalledWith({
      authority: {
        channel: "telegram",
        containerMemberId: GROUP_RUNTIME_MEMBER_ID,
        threadId: "telegram_group",
      },
      prisma: fakeTx,
    });
  });

  it("fails closed when the provider sender cannot be resolved or text is absent", async () => {
    mocks.lookupHostedGroupParticipantMemberByHandle.mockResolvedValueOnce(null);
    await expect(requestHostedGroupCurrentSenderAssistantAsk({
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      now: NOW,
      origin: {
        assistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
        kind: "accepted_input",
        sessionId: "session_group",
      },
    })).resolves.toEqual({
      mailboxWake: null,
      result: {
        status: "unavailable",
        unavailableReason: "current_sender_unavailable",
      },
    });

    mocks.readHostedMailboxConversationWakeByAssistantInputId.mockResolvedValueOnce(
      createSourceWake({ text: "   " }),
    );
    await expect(requestHostedGroupCurrentSenderAssistantAsk({
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      now: NOW,
      origin: {
        assistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
        kind: "accepted_input",
        sessionId: "session_group",
      },
    })).resolves.toEqual({
      mailboxWake: null,
      result: {
        status: "unavailable",
        unavailableReason: "current_sender_unavailable",
      },
    });

    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).not.toHaveBeenCalled();
  });

  it("resolves Telegram through its canonical binding and ignores attribution metadata", async () => {
    mocks.readHostedMailboxConversationWakeByAssistantInputId.mockResolvedValueOnce(
      createTelegramSourceWake(),
    );
    await expect(requestHostedGroupCurrentSenderAssistantAsk({
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      now: NOW,
      origin: {
        assistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
        kind: "accepted_input",
        sessionId: "session_group",
      },
    })).resolves.toMatchObject({
      mailboxWake: { expectedUserId: SENDER_MEMBER_ID },
      result: { status: "accepted" },
    });
    expect(
      mocks.resolveHostedMemberRoutingByTelegramUserId,
    ).toHaveBeenCalledWith({
      prisma: fakeTx,
      telegramUserId: "123456789",
    });

    vi.clearAllMocks();
    mocks.hostedThreadContainerFindUnique.mockImplementation(activeContainerLookup);
    mocks.requireHostedRuntimeActiveAccessForUpdateTx.mockResolvedValue(undefined);
    mocks.assertHostedThreadRouteEgressAuthority.mockResolvedValue(undefined);
    mocks.lookupHostedGroupParticipantMemberByHandle.mockResolvedValue({
      core: { id: SENDER_MEMBER_ID },
    });
    mocks.readHostedMailboxConversationWakeByAssistantInputId.mockResolvedValue(
      createSourceWake({ senderMemberId: "untrusted_attribution_member" }),
    );
    mocks.readHostedMailboxItemById.mockResolvedValue(null);
    mocks.appendHostedMailboxEnvelopeWithIdentityTx.mockImplementation(
      async (input: { itemId: string }) => ({
        dedupeConflict: false,
        item: { id: input.itemId },
      }),
    );

    await expect(requestHostedGroupCurrentSenderAssistantAsk({
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      now: NOW,
      origin: {
        assistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
        kind: "accepted_input",
        sessionId: "session_group",
      },
    })).resolves.toMatchObject({
      mailboxWake: { expectedUserId: SENDER_MEMBER_ID },
      result: { status: "accepted" },
    });
  });

  it("rejects direct, oversized, cross-runtime, and synthetic target inputs", async () => {
    const origin = {
      assistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      kind: "accepted_input" as const,
      sessionId: "session_group",
    };
    const directWake = createSourceWake();
    directWake.message.linqMessage.threadIsDirect = true;

    for (const wake of [
      directWake,
      createSourceWake({ text: "x".repeat(1_201) }),
      {
        ...createSourceWake(),
        userId: "different_group_runtime",
      },
    ]) {
      mocks.readHostedMailboxConversationWakeByAssistantInputId.mockResolvedValueOnce(
        wake,
      );
      await expect(requestHostedGroupCurrentSenderAssistantAsk({
        groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
        now: NOW,
        origin,
      })).resolves.toMatchObject({
        mailboxWake: null,
        result: { status: "unavailable" },
      });
    }

    mocks.hostedThreadContainerFindUnique.mockResolvedValue({
      memberId: GROUP_RUNTIME_MEMBER_ID,
    });
    await expect(requestHostedGroupCurrentSenderAssistantAsk({
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      now: NOW,
      origin,
    })).resolves.toMatchObject({
      mailboxWake: null,
      result: { status: "unavailable" },
    });
  });

  it("revalidates the live group route before touching the personal runtime", async () => {
    mocks.assertHostedThreadRouteEgressAuthority.mockRejectedValue(
      Object.assign(new Error("route removed"), {
        code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
        retryable: false,
      }),
    );

    await expect(requestHostedGroupCurrentSenderAssistantAsk({
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      now: NOW,
      origin: {
        assistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
        kind: "accepted_input",
        sessionId: "session_group",
      },
    })).resolves.toEqual({
      mailboxWake: null,
      result: {
        status: "unavailable",
        unavailableReason: "current_sender_unavailable",
      },
    });
    expect(
      mocks.requireHostedRuntimeActiveAccessForUpdateTx,
    ).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).not.toHaveBeenCalled();
  });
});
