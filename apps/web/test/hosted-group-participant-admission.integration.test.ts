import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencyMocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeWithIdentityTx: vi.fn(),
  appendHostedMailboxEnvelopeWithPreparedCryptoTx: vi.fn(),
  assertHostedThreadRouteEgressAuthority: vi.fn(),
  getHostedLinqChatSummary: vi.fn(),
  lookupHostedGroupParticipantMemberIdsByHandles: vi.fn(),
  readHostedMailboxConversationWakeByAssistantInputId: vi.fn(),
  readHostedMailboxItemById: vi.fn(),
  readHostedMailboxWakeByDedupeKey: vi.fn(),
  readHostedMailboxWakeByItemId: vi.fn(),
  readHostedMemberAddressBookAdvisoryNames: vi.fn(),
  readHostedRuntimeAiAllowedMemberIds: vi.fn(),
  readHostedThreadContainerLinqRouteAuthorities: vi.fn(),
  resolveHostedAssistantNotificationDestination: vi.fn(),
  runWithPreparedHostedMailboxItemAppendCrypto: vi.fn(),
  requireHostedRuntimeActiveAccess: vi.fn(),
  requireHostedRuntimeActiveAccessForUpdateTx: vi.fn(),
}));

vi.mock("../src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeWithIdentityTx:
    dependencyMocks.appendHostedMailboxEnvelopeWithIdentityTx,
  appendHostedMailboxEnvelopeWithPreparedCryptoTx:
    dependencyMocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx,
  readHostedMailboxConversationWakeByAssistantInputId:
    dependencyMocks.readHostedMailboxConversationWakeByAssistantInputId,
  readHostedMailboxItemById: dependencyMocks.readHostedMailboxItemById,
  readHostedMailboxWakeByDedupeKey:
    dependencyMocks.readHostedMailboxWakeByDedupeKey,
  readHostedMailboxWakeByItemId:
    dependencyMocks.readHostedMailboxWakeByItemId,
  runWithPreparedHostedMailboxItemAppendCrypto:
    dependencyMocks.runWithPreparedHostedMailboxItemAppendCrypto,
}));

vi.mock("../src/lib/hosted-mailbox/runtime-access", () => ({
  requireHostedRuntimeActiveAccess:
    dependencyMocks.requireHostedRuntimeActiveAccess,
  requireHostedRuntimeActiveAccessForUpdateTx:
    dependencyMocks.requireHostedRuntimeActiveAccessForUpdateTx,
}));

vi.mock("../src/lib/hosted-routing/thread-route-store", async (
  importOriginal,
) => ({
  ...await importOriginal<
    typeof import("../src/lib/hosted-routing/thread-route-store")
  >(),
  assertHostedThreadRouteEgressAuthority:
    dependencyMocks.assertHostedThreadRouteEgressAuthority,
}));

vi.mock("../src/lib/hosted-routing/assistant-notification-destination", async (
  importOriginal,
) => ({
  ...await importOriginal<
    typeof import("../src/lib/hosted-routing/assistant-notification-destination")
  >(),
  readHostedThreadContainerLinqRouteAuthorities:
    dependencyMocks.readHostedThreadContainerLinqRouteAuthorities,
  resolveHostedAssistantNotificationDestination:
    dependencyMocks.resolveHostedAssistantNotificationDestination,
}));

vi.mock("../src/lib/hosted-address-book/projection", async (importOriginal) => ({
  ...await importOriginal<
    typeof import("../src/lib/hosted-address-book/projection")
  >(),
  readHostedMemberAddressBookAdvisoryNames:
    dependencyMocks.readHostedMemberAddressBookAdvisoryNames,
}));

vi.mock("../src/lib/hosted-onboarding/linq-client", async (importOriginal) => ({
  ...await importOriginal<
    typeof import("../src/lib/hosted-onboarding/linq-client")
  >(),
  getHostedLinqChatSummary: dependencyMocks.getHostedLinqChatSummary,
}));

vi.mock("../src/lib/hosted-onboarding/member-access", async (importOriginal) => ({
  ...await importOriginal<
    typeof import("../src/lib/hosted-onboarding/member-access")
  >(),
  readHostedRuntimeAiAllowedMemberIds:
    dependencyMocks.readHostedRuntimeAiAllowedMemberIds,
}));

vi.mock("../src/lib/hosted-groups/participant-member", async (importOriginal) => ({
  ...await importOriginal<
    typeof import("../src/lib/hosted-groups/participant-member")
  >(),
  lookupHostedGroupParticipantMemberIdsByHandles:
    dependencyMocks.lookupHostedGroupParticipantMemberIdsByHandles,
}));

import {
  createHostedAssistantAskCompletionId,
  createHostedAssistantAskRequestId,
  handleHostedRuntimeAssistantAskControl,
  requestHostedGroupAssistantAsk,
  requestHostedGroupContextHandoff,
} from "../src/lib/hosted-groups/group-assistant-ask";

const NOW = new Date("2026-08-26T12:00:00.000Z");
const ORIGIN_MEMBER_ID = "member_requester";
const ORIGIN_ASSISTANT_INPUT_ID = `ain_${"a".repeat(32)}`;
const ORIGIN_SESSION_ID = "session_private_participant_target";
const REQUESTER_PHONE = "+12125550000";
const PROVIDER_PHONE = "+15550000000";
const FIRST_RUNTIME_MEMBER_ID = "runtime_first_group";
const SECOND_RUNTIME_MEMBER_ID = "runtime_second_group";

interface MembershipFixture {
  group: {
    displayName: string | null;
    runtimeMemberId: string;
  };
  id: string;
  memberId: string;
}

function membership(input: {
  displayName?: string | null;
  id: string;
  runtimeMemberId: string;
}): MembershipFixture {
  return {
    group: {
      displayName: input.displayName ?? null,
      runtimeMemberId: input.runtimeMemberId,
    },
    id: input.id,
    memberId: ORIGIN_MEMBER_ID,
  };
}

function directOriginWake() {
  return {
    eventId: "origin_event",
    kind: "conversation.message" as const,
    message: {
      channel: "linq" as const,
      linqMessage: {
        chatId: "private_chat",
        from: REQUESTER_PHONE,
        isFromMe: false,
        messageId: "origin_message",
        parts: [{ text: "Ask the matching group.", type: "text" as const }],
        threadIsDirect: true,
      },
      phoneLookupKey: "private_lookup_key",
    },
    occurredAt: NOW.toISOString(),
    userId: ORIGIN_MEMBER_ID,
  };
}

function createPrisma(memberships: readonly MembershipFixture[]) {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([{ id: "locked_membership" }]),
    hostedGroupMember: {
      findMany: vi.fn().mockResolvedValue(memberships),
      findUnique: vi.fn(async (query: { where: { id: string } }) =>
        memberships.find(({ id }) => id === query.where.id) ?? null
      ),
    },
    hostedThreadContainer: {
      findUnique: vi.fn(async (query: { where: { memberId: string } }) =>
        query.where.memberId === ORIGIN_MEMBER_ID
          ? null
          : memberships.some(({ group }) =>
              group.runtimeMemberId === query.where.memberId
            )
            ? { memberId: query.where.memberId }
            : null
      ),
    },
  };
  return {
    prisma: {
      ...tx,
      $transaction: vi.fn(async (
        run: (value: typeof tx) => Promise<unknown>,
      ) => run(tx)),
    },
    tx,
  };
}

function routeAuthority(runtimeMemberId: string, threadId: string) {
  return {
    accountLookupKey: "linq_account",
    channel: "linq" as const,
    containerMemberId: runtimeMemberId,
    threadId,
  };
}

describe("participant selection composed with Assistant Ask admission", () => {
  const mailboxWakes = new Map<string, Record<string, unknown>>();
  const mailboxItems = new Map<string, {
    dedupeKey: string;
    expiresAt: string;
    id: string;
    kind: string;
    userId: string;
  }>();

  beforeEach(() => {
    vi.clearAllMocks();
    mailboxWakes.clear();
    mailboxItems.clear();
    dependencyMocks.requireHostedRuntimeActiveAccess.mockResolvedValue({});
    dependencyMocks.requireHostedRuntimeActiveAccessForUpdateTx
      .mockResolvedValue({});
    dependencyMocks.readHostedMailboxConversationWakeByAssistantInputId
      .mockResolvedValue(directOriginWake());
    dependencyMocks.readHostedMailboxItemById.mockImplementation(
      async ({ mailboxItemId }: { mailboxItemId: string }) =>
        mailboxItems.get(mailboxItemId) ?? null,
    );
    dependencyMocks.readHostedMailboxWakeByItemId.mockImplementation(
      async ({ mailboxItemId }: { mailboxItemId: string }) =>
        mailboxWakes.get(mailboxItemId) ?? null,
    );
    dependencyMocks.readHostedMailboxWakeByDedupeKey.mockImplementation(
      async ({ dedupeKey }: { dedupeKey: string }) =>
        mailboxWakes.get(dedupeKey) ?? null,
    );
    dependencyMocks.appendHostedMailboxEnvelopeWithIdentityTx.mockImplementation(
      async (input: {
        envelope: { eventId: string; kind: string; userId: string };
        expiresAt: string;
        itemId: string;
      }) => {
        mailboxWakes.set(input.itemId, input.envelope);
        mailboxItems.set(input.itemId, {
          dedupeKey: input.itemId,
          expiresAt: input.expiresAt,
          id: input.itemId,
          kind: input.envelope.kind,
          userId: input.envelope.userId,
        });
        return {
          dedupeConflict: false,
          duplicate: false,
          inserted: true,
          item: { id: input.itemId, userId: input.envelope.userId },
        };
      },
    );
    dependencyMocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx
      .mockImplementation(async (input: {
        envelope: { eventId: string; kind: string; userId: string };
        expiresAt: string;
        itemId: string;
      }) => {
        mailboxWakes.set(input.itemId, input.envelope);
        mailboxItems.set(input.itemId, {
          dedupeKey: input.itemId,
          expiresAt: input.expiresAt,
          id: input.itemId,
          kind: input.envelope.kind,
          userId: input.envelope.userId,
        });
        return {
          dedupeConflict: false,
          duplicate: false,
          inserted: true,
          item: { id: input.itemId, userId: input.envelope.userId },
        };
      });
    dependencyMocks.runWithPreparedHostedMailboxItemAppendCrypto
      .mockImplementation(async (input: {
        append: (prepared: object) => Promise<unknown>;
        prepareExisting?: () => Promise<void>;
      }) => {
        await input.prepareExisting?.();
        return input.append({
          domain: "mailbox-payload",
          rootKeyId: "root-key",
          userId: SECOND_RUNTIME_MEMBER_ID,
        });
      });
    dependencyMocks.assertHostedThreadRouteEgressAuthority.mockResolvedValue({});
  });

  function installExactDestination(runtimeMemberId: string, threadId: string) {
    const externalThreadRouteAuthority = routeAuthority(runtimeMemberId, threadId);
    dependencyMocks.resolveHostedAssistantNotificationDestination
      .mockResolvedValue({
        conversationShape: "thread-container",
        externalThreadRouteAuthority,
        route: {
          actorId: null,
          channel: "linq",
          delivery: { kind: "thread", target: threadId },
          identityId: "group-identity",
          threadId: "group-thread",
          threadIsDirect: false,
        },
      });
  }

  it("selects one live roster, appends only that membership, and completes privately", async () => {
    const memberships = [
      membership({
        displayName: null,
        id: "membership_first",
        runtimeMemberId: FIRST_RUNTIME_MEMBER_ID,
      }),
      membership({
        displayName: "Weekend Crew",
        id: "membership_second",
        runtimeMemberId: SECOND_RUNTIME_MEMBER_ID,
      }),
    ];
    const { prisma } = createPrisma(memberships);
    dependencyMocks.readHostedRuntimeAiAllowedMemberIds.mockResolvedValue(
      new Set([FIRST_RUNTIME_MEMBER_ID, SECOND_RUNTIME_MEMBER_ID]),
    );
    dependencyMocks.readHostedThreadContainerLinqRouteAuthorities
      .mockResolvedValue({
        authorities: new Map([
          [FIRST_RUNTIME_MEMBER_ID, routeAuthority(
            FIRST_RUNTIME_MEMBER_ID,
            "chat_first",
          )],
          [SECOND_RUNTIME_MEMBER_ID, routeAuthority(
            SECOND_RUNTIME_MEMBER_ID,
            "chat_second",
          )],
        ]),
        nonLinqContainerMemberIds: new Set(),
        unavailableContainerMemberIds: new Set(),
      });
    dependencyMocks.getHostedLinqChatSummary.mockImplementation(
      async ({ chatId }: { chatId: string }) => {
        const otherHandles = chatId === "chat_second"
          ? ["+14155550101", "+14155550202"]
          : ["+14155550303"];
        return {
          handleCount: otherHandles.length + 2,
          handles: [
            { handle: PROVIDER_PHONE, isMe: true, status: "active" },
            { handle: REQUESTER_PHONE, isMe: false, status: "active" },
            ...otherHandles.map((handle) => ({
              handle,
              isMe: false,
              status: "active",
            })),
          ],
          handlesComplete: true,
          isGroup: true,
        };
      },
    );
    dependencyMocks.lookupHostedGroupParticipantMemberIdsByHandles
      .mockResolvedValue(new Map([[REQUESTER_PHONE, ORIGIN_MEMBER_ID]]));
    dependencyMocks.readHostedMemberAddressBookAdvisoryNames.mockResolvedValue({
      canonicalHandleCount: 3,
      contactMatchCount: 2,
      names: new Map([
        ["+14155550101", "Jordan"],
        ["+14155550202", "Casey"],
      ]),
      outcome: "matched",
      requestedHandleCount: 3,
    });

    const requestId = createHostedAssistantAskRequestId({
      memberId: ORIGIN_MEMBER_ID,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
    });
    await expect(requestHostedGroupAssistantAsk({
      memberId: ORIGIN_MEMBER_ID,
      now: NOW,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      originSessionId: ORIGIN_SESSION_ID,
      participantTarget: {
        participantCount: 2,
        participants: [
          { displayName: "Jordan" },
          { displayName: "Casey" },
        ],
      },
      prisma: prisma as never,
      question: "What is the plan for this weekend?",
    })).resolves.toMatchObject({
      mailboxWake: {
        expectedUserId: SECOND_RUNTIME_MEMBER_ID,
        mailboxItemId: requestId,
      },
      result: {
        status: "accepted",
        targetLabel: "Weekend Crew — 2 people: Jordan, Casey",
      },
    });

    expect(mailboxWakes.get(requestId)).toMatchObject({
      ask: {
        target: {
          kind: "joined_group",
          membershipId: "membership_second",
        },
      },
      userId: SECOND_RUNTIME_MEMBER_ID,
    });
    expect(
      [...mailboxWakes.values()].some((wake) =>
        wake.userId === FIRST_RUNTIME_MEMBER_ID
      ),
    ).toBe(false);

    const completionId = createHostedAssistantAskCompletionId(requestId);
    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: SECOND_RUNTIME_MEMBER_ID,
      now: NOW,
      prisma: prisma as never,
      request: {
        action: "complete",
        requestId,
        result: {
          answer: "The group plans to meet Saturday morning.",
          outcome: "answered",
        },
      },
    })).resolves.toEqual({
      mailboxWake: {
        expectedUserId: ORIGIN_MEMBER_ID,
        mailboxItemId: completionId,
      },
      response: { action: "complete", status: "completed" },
    });
    expect(mailboxWakes.get(completionId)).toMatchObject({
      ask: {
        requestId,
        result: {
          answer: "The group plans to meet Saturday morning.",
          outcome: "answered",
        },
      },
      kind: "assistant.ask.completed",
      userId: ORIGIN_MEMBER_ID,
    });
  });

  it("binds a participant-selected handoff to only the exact group route", async () => {
    const memberships = [
      membership({
        id: "membership_first",
        runtimeMemberId: FIRST_RUNTIME_MEMBER_ID,
      }),
      membership({
        displayName: "Weekend Crew",
        id: "membership_second",
        runtimeMemberId: SECOND_RUNTIME_MEMBER_ID,
      }),
    ];
    const { prisma } = createPrisma(memberships);
    dependencyMocks.readHostedRuntimeAiAllowedMemberIds.mockResolvedValue(
      new Set([FIRST_RUNTIME_MEMBER_ID, SECOND_RUNTIME_MEMBER_ID]),
    );
    dependencyMocks.readHostedThreadContainerLinqRouteAuthorities
      .mockResolvedValue({
        authorities: new Map([
          [FIRST_RUNTIME_MEMBER_ID, routeAuthority(
            FIRST_RUNTIME_MEMBER_ID,
            "chat_first",
          )],
          [SECOND_RUNTIME_MEMBER_ID, routeAuthority(
            SECOND_RUNTIME_MEMBER_ID,
            "chat_second",
          )],
        ]),
        nonLinqContainerMemberIds: new Set(),
        unavailableContainerMemberIds: new Set(),
      });
    dependencyMocks.getHostedLinqChatSummary.mockImplementation(
      async ({ chatId }: { chatId: string }) => {
        const otherHandle = chatId === "chat_second"
          ? "+14155550606"
          : "+14155550707";
        return {
          handleCount: 3,
          handles: [
            { handle: PROVIDER_PHONE, isMe: true, status: "active" },
            { handle: REQUESTER_PHONE, isMe: false, status: "active" },
            { handle: otherHandle, isMe: false, status: "active" },
          ],
          handlesComplete: true,
          isGroup: true,
        };
      },
    );
    dependencyMocks.lookupHostedGroupParticipantMemberIdsByHandles
      .mockResolvedValue(new Map([[REQUESTER_PHONE, ORIGIN_MEMBER_ID]]));
    dependencyMocks.readHostedMemberAddressBookAdvisoryNames.mockResolvedValue({
      canonicalHandleCount: 2,
      contactMatchCount: 1,
      names: new Map([["+14155550606", "Jordan"]]),
      outcome: "matched",
      requestedHandleCount: 2,
    });
    installExactDestination(SECOND_RUNTIME_MEMBER_ID, "chat_second");

    await expect(requestHostedGroupContextHandoff({
      context: "The requester completed the planned mobility set.",
      memberId: ORIGIN_MEMBER_ID,
      now: NOW,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      participantTarget: {
        participantCount: 1,
        participants: [{ displayName: "Jordan" }],
      },
      prisma: prisma as never,
    })).resolves.toMatchObject({
      mailboxWake: { expectedUserId: SECOND_RUNTIME_MEMBER_ID },
      result: {
        status: "accepted",
        targetLabel: "Weekend Crew — 1 person: Jordan",
      },
    });

    const handoffWake = [...mailboxWakes.values()].find((wake) =>
      wake.kind === "assistant.notification.requested"
    );
    expect(handoffWake).toMatchObject({
      notification: {
        externalThreadRouteAuthority: {
          containerMemberId: SECOND_RUNTIME_MEMBER_ID,
          threadId: "chat_second",
        },
        groupContextHandoff: { membershipId: "membership_second" },
        notificationPromptProfile: "context-handoff",
        responsePolicy: { kind: "require_send" },
        route: {
          delivery: { kind: "thread", target: "chat_second" },
          threadIsDirect: false,
        },
      },
      userId: SECOND_RUNTIME_MEMBER_ID,
    });
    expect(
      [...mailboxWakes.values()].some((wake) =>
        wake.userId === FIRST_RUNTIME_MEMBER_ID
      ),
    ).toBe(false);
  });

  it("keeps duplicate safe roster descriptions unavailable without appending", async () => {
    const memberships = [
      membership({
        id: "membership_first",
        runtimeMemberId: FIRST_RUNTIME_MEMBER_ID,
      }),
      membership({
        id: "membership_second",
        runtimeMemberId: SECOND_RUNTIME_MEMBER_ID,
      }),
    ];
    const { prisma } = createPrisma(memberships);
    dependencyMocks.readHostedRuntimeAiAllowedMemberIds.mockResolvedValue(
      new Set([FIRST_RUNTIME_MEMBER_ID, SECOND_RUNTIME_MEMBER_ID]),
    );
    dependencyMocks.readHostedThreadContainerLinqRouteAuthorities
      .mockResolvedValue({
        authorities: new Map([
          [FIRST_RUNTIME_MEMBER_ID, routeAuthority(
            FIRST_RUNTIME_MEMBER_ID,
            "chat_first",
          )],
          [SECOND_RUNTIME_MEMBER_ID, routeAuthority(
            SECOND_RUNTIME_MEMBER_ID,
            "chat_second",
          )],
        ]),
        nonLinqContainerMemberIds: new Set(),
        unavailableContainerMemberIds: new Set(),
      });
    dependencyMocks.getHostedLinqChatSummary.mockImplementation(
      async ({ chatId }: { chatId: string }) => ({
        handleCount: 3,
        handles: [
          { handle: PROVIDER_PHONE, isMe: true, status: "active" },
          { handle: REQUESTER_PHONE, isMe: false, status: "active" },
          {
            handle: chatId === "chat_first"
              ? "+14155550404"
              : "+14155550505",
            isMe: false,
            status: "active",
          },
        ],
        handlesComplete: true,
        isGroup: true,
      }),
    );
    dependencyMocks.lookupHostedGroupParticipantMemberIdsByHandles
      .mockResolvedValue(new Map([[REQUESTER_PHONE, ORIGIN_MEMBER_ID]]));
    dependencyMocks.readHostedMemberAddressBookAdvisoryNames.mockResolvedValue({
      canonicalHandleCount: 2,
      contactMatchCount: 2,
      names: new Map([
        ["+14155550404", "Jordan"],
        ["+14155550505", "Jordan"],
      ]),
      outcome: "matched",
      requestedHandleCount: 2,
    });

    await expect(requestHostedGroupAssistantAsk({
      memberId: ORIGIN_MEMBER_ID,
      now: NOW,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      originSessionId: ORIGIN_SESSION_ID,
      participantTarget: {
        participantCount: 1,
        participants: [{ displayName: "Jordan" }],
      },
      prisma: prisma as never,
      question: "What is the plan?",
    })).resolves.toEqual({
      mailboxWake: null,
      result: {
        status: "unavailable",
        unavailableReason: "ambiguous_participant_target",
      },
    });
    expect(mailboxWakes).toHaveLength(0);
  });
});
