import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeWithIdentityTx: vi.fn(),
  readHostedMailboxWakeByItemId: vi.fn(),
  resolveHostedAssistantNotificationDestination: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeWithIdentityTx:
    mocks.appendHostedMailboxEnvelopeWithIdentityTx,
  readHostedMailboxConversationWakeByAssistantInputId: vi.fn(),
  readHostedMailboxItemById: vi.fn(),
  readHostedMailboxWakeByItemId: mocks.readHostedMailboxWakeByItemId,
}));
vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({
  requireHostedRuntimeActiveAccessForUpdateTx: vi.fn(),
}));
vi.mock("@/src/lib/hosted-routing/assistant-notification-destination", () => ({
  resolveHostedAssistantNotificationDestination:
    mocks.resolveHostedAssistantNotificationDestination,
}));
vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  assertHostedThreadRouteEgressAuthority: vi.fn(),
}));
vi.mock("@/src/lib/hosted-groups/group-message-sender", () => ({
  resolveHostedGroupMessageSenderMemberId: vi.fn(),
}));
vi.mock("@/src/lib/prisma", () => ({
  getPrisma: vi.fn(),
}));

import {
  appendHostedGroupCurrentSenderPrivateCompletionTx,
  buildHostedGroupCurrentSenderPrivateResponseText,
  createHostedGroupCurrentSenderAssistantAskRequestId,
  readHostedGroupCurrentSenderPrivateCompletionMailboxWakeTx,
  type HostedGroupCurrentSenderPrivateCompletionAuthority,
} from "@/src/lib/hosted-groups/group-current-sender-assistant-ask";

const INPUT_ID = `ain_${"a".repeat(32)}`;
const COMPLETION_ID = `aask_done_${"b".repeat(64)}`;
const NOW = new Date("2026-08-09T05:00:00.000Z");
const ROUTE = {
  actorId: null,
  channel: "linq" as const,
  delivery: {
    kind: "thread" as const,
    target: "linq-private-thread",
  },
  identityId: `hid_${"1".repeat(32)}`,
  threadId: `hid_${"2".repeat(32)}`,
  threadIsDirect: true,
};
const AUTHORITY: HostedGroupCurrentSenderPrivateCompletionAuthority = {
  expiresAt: "2026-08-09T05:10:00.000Z",
  groupRuntimeMemberId: "member_group_runtime",
  occurredAt: "2026-08-09T04:59:00.000Z",
  origin: {
    assistantInputId: INPUT_ID,
    kind: "accepted_input",
    sessionId: "session_group",
  },
  permissionDigest: "d".repeat(64),
  permissionText: "One private owner-only answer.",
  question: "Murph text me individually about today's workout",
  responseDestination: "current_sender",
  sourceChannel: "linq",
  targetMemberId: "member_sender",
};

describe("hosted private current-sender Assistant Ask completion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveHostedAssistantNotificationDestination.mockResolvedValue({
      conversationShape: "direct-member",
      externalThreadRouteAuthority: null,
      route: ROUTE,
    });
    mocks.appendHostedMailboxEnvelopeWithIdentityTx.mockImplementation(
      async (input: { itemId: string }) => ({
        dedupeConflict: false,
        item: { id: input.itemId },
      }),
    );
  });

  it("uses the direct destination's stable request identity", () => {
    const input = {
      groupRuntimeMemberId: AUTHORITY.groupRuntimeMemberId,
      originAssistantInputId: INPUT_ID,
      responseDestination: "current_sender" as const,
    };
    const requestId =
      createHostedGroupCurrentSenderAssistantAskRequestId(input);
    expect(requestId).toBe(
      createHostedGroupCurrentSenderAssistantAskRequestId(input),
    );
    expect(requestId).toMatch(/^aask_req_[a-f0-9]{64}$/u);
  });

  it("queues the reviewed answer as exact text on the sender's private route", async () => {
    const tx = {};
    const mailboxWake =
      await appendHostedGroupCurrentSenderPrivateCompletionTx({
        authority: AUTHORITY,
        completionId: COMPLETION_ID,
        now: NOW,
        result: {
          answer: "Here's the private workout based on your recent training.",
          outcome: "answered",
        },
        tx: tx as never,
      });

    expect(mailboxWake).toEqual({
      expectedUserId: AUTHORITY.targetMemberId,
      mailboxItemId: COMPLETION_ID,
    });
    expect(
      mocks.resolveHostedAssistantNotificationDestination,
    ).toHaveBeenCalledWith({
      directChannel: "linq",
      memberId: AUTHORITY.targetMemberId,
      prisma: tx,
    });
    const append = mocks.appendHostedMailboxEnvelopeWithIdentityTx.mock.calls[0]?.[0];
    expect(append).toMatchObject({
      envelope: {
        eventId: COMPLETION_ID,
        kind: "assistant.notification.requested",
        notification: {
          deliveryDispatchMode: "queue-only",
          externalThreadRouteAuthority: null,
          privateAssistantAskCompletion: {
            expiresAt: AUTHORITY.expiresAt,
            requestId:
              createHostedGroupCurrentSenderAssistantAskRequestId({
                groupRuntimeMemberId: AUTHORITY.groupRuntimeMemberId,
                originAssistantInputId: INPUT_ID,
                responseDestination: "current_sender",
              }),
          },
          responsePolicy: {
            kind: "require_send_exact_text",
            text: "Here's the private workout based on your recent training.",
          },
          route: ROUTE,
        },
        userId: AUTHORITY.targetMemberId,
      },
      expiresAt: AUTHORITY.expiresAt,
      itemId: COMPLETION_ID,
      tx,
    });
  });

  it("uses fixed private copy when the reviewed read cannot answer", () => {
    expect(buildHostedGroupCurrentSenderPrivateResponseText({
      answer: null,
      outcome: "cannot_answer",
    })).toBe(
      "I don't have enough context to answer that privately yet.",
    );
  });

  it("fails closed when the sender has no same-channel direct route", async () => {
    mocks.resolveHostedAssistantNotificationDestination.mockResolvedValue(null);
    await expect(appendHostedGroupCurrentSenderPrivateCompletionTx({
      authority: AUTHORITY,
      completionId: COMPLETION_ID,
      now: NOW,
      result: { answer: null, outcome: "cannot_answer" },
      tx: {} as never,
    })).resolves.toBeNull();
    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).not.toHaveBeenCalled();
  });

  it("recognizes only the exact stored private completion", async () => {
    const tx = {};
    await appendHostedGroupCurrentSenderPrivateCompletionTx({
      authority: AUTHORITY,
      completionId: COMPLETION_ID,
      now: NOW,
      result: { answer: "Private answer.", outcome: "answered" },
      tx: tx as never,
    });
    const envelope =
      mocks.appendHostedMailboxEnvelopeWithIdentityTx.mock.calls[0]?.[0].envelope;
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue(envelope);

    await expect(
      readHostedGroupCurrentSenderPrivateCompletionMailboxWakeTx({
        authority: AUTHORITY,
        completionId: COMPLETION_ID,
        existingCompletion: {
          dedupeKey: COMPLETION_ID,
          expiresAt: AUTHORITY.expiresAt,
          kind: "assistant.notification.requested",
          userId: AUTHORITY.targetMemberId,
        },
        now: NOW,
        tx: tx as never,
      }),
    ).resolves.toEqual({
      expectedUserId: AUTHORITY.targetMemberId,
      mailboxItemId: COMPLETION_ID,
    });
  });
});
