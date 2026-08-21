import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeWithIdentityTx: vi.fn(),
  appendHostedMailboxEnvelopeWithPreparedCryptoTx: vi.fn(),
  assertHostedThreadRouteEgressAuthority: vi.fn(),
  bindHostedAssistantNotificationDestination: vi.fn(),
  readHostedMailboxConversationWakeByAssistantInputId: vi.fn(),
  readHostedMailboxItemById: vi.fn(),
  readHostedMailboxWakeByDedupeKey: vi.fn(),
  readHostedMailboxWakeByItemId: vi.fn(),
  requireHostedRuntimeActiveAccess: vi.fn(),
  requireHostedRuntimeActiveAccessForUpdateTx: vi.fn(),
  resolveHostedAssistantNotificationDestination: vi.fn(),
  runWithPreparedHostedMailboxItemAppendCrypto: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeWithIdentityTx:
    mocks.appendHostedMailboxEnvelopeWithIdentityTx,
  appendHostedMailboxEnvelopeWithPreparedCryptoTx:
    mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx,
  readHostedMailboxConversationWakeByAssistantInputId:
    mocks.readHostedMailboxConversationWakeByAssistantInputId,
  readHostedMailboxItemById: mocks.readHostedMailboxItemById,
  readHostedMailboxWakeByDedupeKey: mocks.readHostedMailboxWakeByDedupeKey,
  readHostedMailboxWakeByItemId: mocks.readHostedMailboxWakeByItemId,
  runWithPreparedHostedMailboxItemAppendCrypto:
    mocks.runWithPreparedHostedMailboxItemAppendCrypto,
}));

vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({
  requireHostedRuntimeActiveAccess: mocks.requireHostedRuntimeActiveAccess,
  requireHostedRuntimeActiveAccessForUpdateTx:
    mocks.requireHostedRuntimeActiveAccessForUpdateTx,
}));

vi.mock("@/src/lib/hosted-routing/assistant-notification-destination", () => ({
  bindHostedAssistantNotificationDestination:
    mocks.bindHostedAssistantNotificationDestination,
  resolveHostedAssistantNotificationDestination:
    mocks.resolveHostedAssistantNotificationDestination,
}));

vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  assertHostedLinqRouteEgressAuthority: vi.fn(),
  assertHostedThreadRouteEgressAuthority:
    mocks.assertHostedThreadRouteEgressAuthority,
}));

import {
  buildHostedGroupContextHandoffInstructions,
  createHostedAssistantAskCompletionId,
  createHostedAssistantAskRequestId,
  createHostedGroupContextHandoffEventId,
  handleHostedRuntimeAssistantAskControl,
  requestHostedGroupAssistantAsk,
  requestHostedGroupContextHandoff,
} from "@/src/lib/hosted-groups/group-assistant-ask";
import {
  buildHostedExecutionAssistantAskCompletedWake,
  buildHostedExecutionAssistantAskRequestedWake,
  buildHostedExecutionAssistantNotificationRequestedWake,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_RUNTIME_GROUP_CONTEXT_HANDOFF_TTL_MS,
} from "@murphai/hosted-execution/runtime-control";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const NOW = new Date("2026-07-15T12:00:00.000Z");
const ORIGIN_MEMBER_ID = "member-personal";
const TARGET_RUNTIME_MEMBER_ID = "member-group-runtime";
const ORIGIN_ASSISTANT_INPUT_ID = `ain_${"a".repeat(32)}`;
const ORIGIN_SESSION_ID = "session_private";
const QUESTION = "What is today's workout?";

function directOriginWake() {
  return {
    eventId: "origin-event",
    kind: "conversation.message" as const,
    message: {
      channel: "linq" as const,
      linqMessage: {
        chatId: "direct-chat",
        from: "+15550001111",
        isFromMe: false,
        messageId: "origin-message",
        parts: [{ text: "please ask the group", type: "text" as const }],
        threadIsDirect: true,
      },
      phoneLookupKey: "lookup-key",
    },
    occurredAt: NOW.toISOString(),
    userId: ORIGIN_MEMBER_ID,
  };
}

function membership(input: {
  displayName?: string | null;
  id?: string;
  memberId?: string;
  runtimeMemberId?: string | null;
} = {}) {
  return {
    group: {
      displayName: input.displayName ?? "100 Club",
      runtimeMemberId: input.runtimeMemberId === undefined
        ? TARGET_RUNTIME_MEMBER_ID
        : input.runtimeMemberId,
    },
    id: input.id ?? "membership-one",
    memberId: input.memberId ?? ORIGIN_MEMBER_ID,
  };
}

function createPrisma(input: {
  memberships?: ReturnType<typeof membership>[];
  selectedMembership?: ReturnType<typeof membership> | null;
  syntheticOrigin?: boolean;
} = {}) {
  const selectedMembership = input.selectedMembership === undefined
    ? membership()
    : input.selectedMembership;
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([{ id: selectedMembership?.id ?? "missing" }]),
    hostedGroupMember: {
      findMany: vi.fn().mockResolvedValue(input.memberships ?? [membership()]),
      findUnique: vi.fn().mockResolvedValue(selectedMembership),
    },
    hostedThreadContainer: {
      findUnique: vi.fn(async (query: { where: { memberId: string } }) => {
        if (query.where.memberId === ORIGIN_MEMBER_ID) {
          return input.syntheticOrigin ? { memberId: ORIGIN_MEMBER_ID } : null;
        }
        return query.where.memberId === TARGET_RUNTIME_MEMBER_ID
          ? { memberId: TARGET_RUNTIME_MEMBER_ID }
          : null;
      }),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (run: (value: typeof tx) => Promise<unknown>) => run(tx)),
  };
  return { prisma, tx };
}

function requestWake(input: {
  membershipId?: string;
  requestedLabel?: string | null;
} = {}) {
  const requestId = createHostedAssistantAskRequestId({
    memberId: ORIGIN_MEMBER_ID,
    originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
  });
  return buildHostedExecutionAssistantAskRequestedWake({
    ask: {
      expiresAt: new Date(
        NOW.getTime() + HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
      ).toISOString(),
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      originSessionId: ORIGIN_SESSION_ID,
      question: QUESTION,
      target: {
        kind: "joined_group",
        membershipId: input.membershipId ?? "membership-one",
        requestedLabel: input.requestedLabel ?? null,
      },
    },
    eventId: requestId,
    memberId: TARGET_RUNTIME_MEMBER_ID,
    occurredAt: NOW.toISOString(),
  });
}

function mailboxItemForWake(wake: ReturnType<typeof requestWake>) {
  return {
    dedupeKey: wake.eventId,
    expiresAt: wake.ask.expiresAt,
    id: wake.eventId,
    kind: wake.kind,
    userId: wake.userId,
  };
}

function groupDestination() {
  const externalThreadRouteAuthority = {
    accountLookupKey: "linq-account-key",
    channel: "linq" as const,
    containerMemberId: TARGET_RUNTIME_MEMBER_ID,
    threadId: "linq-group-chat",
  };
  const route = {
    actorId: null,
    channel: "linq" as const,
    delivery: {
      kind: "thread" as const,
      target: "linq-group-chat",
    },
    identityId: "group-identity",
    threadId: "group-thread",
    threadIsDirect: false,
  };
  return {
    bound: { externalThreadRouteAuthority, route },
    destination: {
      conversationShape: "thread-container" as const,
      externalThreadRouteAuthority,
      route,
    },
  };
}

function contextHandoffWake(input: {
  context: string;
  membershipId?: string;
  occurredAt?: Date;
  targetRuntimeMemberId?: string;
}) {
  const occurredAt = input.occurredAt ?? NOW;
  const targetRuntimeMemberId = input.targetRuntimeMemberId
    ?? TARGET_RUNTIME_MEMBER_ID;
  const eventId = createHostedGroupContextHandoffEventId({
    memberId: ORIGIN_MEMBER_ID,
    originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
  });
  const destination = groupDestination().bound;
  return buildHostedExecutionAssistantNotificationRequestedWake({
    eventId,
    memberId: targetRuntimeMemberId,
    notification: {
      deliveryDedupeToken: eventId,
      deliveryDispatchMode: "queue-only",
      deliveryIdempotencyKey: eventId,
      externalThreadRouteAuthority: {
        ...destination.externalThreadRouteAuthority,
        containerMemberId: targetRuntimeMemberId,
      },
      groupContextHandoff: {
        membershipId: input.membershipId ?? "membership-one",
        originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      },
      instructions: buildHostedGroupContextHandoffInstructions({
        context: input.context,
      }),
      notificationPromptProfile: "context-handoff",
      responsePolicy: { kind: "require_send" },
      route: destination.route,
    },
    occurredAt: occurredAt.toISOString(),
  });
}

function mailboxItemForContextHandoff(
  wake: ReturnType<typeof contextHandoffWake>,
) {
  return {
    dedupeKey: wake.eventId,
    expiresAt: new Date(
      Date.parse(wake.occurredAt)
        + HOSTED_RUNTIME_GROUP_CONTEXT_HANDOFF_TTL_MS,
    ).toISOString(),
    id: wake.eventId,
    kind: wake.kind,
    userId: wake.userId,
  };
}

describe("Hosted group Assistant Ask admission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readHostedMailboxItemById.mockResolvedValue(null);
    mocks.readHostedMailboxConversationWakeByAssistantInputId.mockResolvedValue(
      directOriginWake(),
    );
    mocks.requireHostedRuntimeActiveAccess.mockResolvedValue(undefined);
    mocks.requireHostedRuntimeActiveAccessForUpdateTx.mockResolvedValue(undefined);
    mocks.appendHostedMailboxEnvelopeWithIdentityTx.mockImplementation(
      async (input: { envelope: { eventId: string; userId: string } }) => ({
        dedupeConflict: false,
        duplicate: false,
        inserted: true,
        item: {
          id: input.envelope.eventId,
          userId: input.envelope.userId,
        },
      }),
    );
    mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx.mockImplementation(
      async (input: { envelope: { eventId: string; userId: string } }) => ({
        dedupeConflict: false,
        duplicate: false,
        inserted: true,
        item: {
          id: input.envelope.eventId,
          userId: input.envelope.userId,
        },
      }),
    );
    const destination = groupDestination();
    mocks.resolveHostedAssistantNotificationDestination.mockResolvedValue(
      destination.destination,
    );
    mocks.bindHostedAssistantNotificationDestination.mockReturnValue(
      destination.bound,
    );
    mocks.assertHostedThreadRouteEgressAuthority.mockResolvedValue({});
    mocks.runWithPreparedHostedMailboxItemAppendCrypto.mockImplementation(
      async (input: {
        append: (prepared: object) => Promise<unknown>;
        prepareExisting?: () => Promise<void>;
      }) => {
        await input.prepareExisting?.();
        return input.append({
          domain: "mailbox-payload",
          rootKeyId: "root-key",
          userId: TARGET_RUNTIME_MEMBER_ID,
        });
      },
    );
  });

  it("automatically selects the only membership and appends one expiring request", async () => {
    const { prisma, tx } = createPrisma();
    const requestId = createHostedAssistantAskRequestId({
      memberId: ORIGIN_MEMBER_ID,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
    });

    await expect(requestHostedGroupAssistantAsk({
      memberId: ORIGIN_MEMBER_ID,
      now: NOW,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      originSessionId: ORIGIN_SESSION_ID,
      prisma: prisma as never,
      question: `  ${QUESTION}  `,
    })).resolves.toEqual({
      mailboxWake: {
        expectedUserId: TARGET_RUNTIME_MEMBER_ID,
        mailboxItemId: requestId,
      },
      result: { status: "accepted", targetLabel: "100 Club" },
    });

    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        ask: {
          expiresAt: new Date(
            NOW.getTime() + HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
          ).toISOString(),
          originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
          originSessionId: ORIGIN_SESSION_ID,
          question: QUESTION,
          target: {
            kind: "joined_group",
            membershipId: "membership-one",
            requestedLabel: null,
          },
        },
        eventId: requestId,
        kind: "assistant.ask.requested",
        userId: TARGET_RUNTIME_MEMBER_ID,
      }),
      expiresAt: new Date(
        NOW.getTime() + HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
      ).toISOString(),
      itemId: requestId,
      tx: expect.any(Object),
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("resolves a normalized unique label and keeps the selector in the request", async () => {
    const selected = membership({ displayName: "100 Club", id: "membership-two" });
    const { prisma, tx } = createPrisma({
      memberships: [
        membership({ displayName: "Mobility Crew", id: "membership-one" }),
        selected,
      ],
      selectedMembership: selected,
    });

    await expect(requestHostedGroupAssistantAsk({
      groupLabel: "  100   CLUB  ",
      memberId: ORIGIN_MEMBER_ID,
      now: NOW,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      originSessionId: ORIGIN_SESSION_ID,
      prisma: prisma as never,
      question: QUESTION,
    })).resolves.toMatchObject({
      result: { status: "accepted", targetLabel: "100 Club" },
    });

    expect(tx.hostedGroupMember.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "membership-two" } }),
    );
    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          ask: expect.objectContaining({
            target: expect.objectContaining({ requestedLabel: "100 club" }),
          }),
        }),
      }),
    );
  });

  it("asks for a label when multiple groups exist and no selector was supplied", async () => {
    const { prisma } = createPrisma({
      memberships: [
        membership({ displayName: "100 Club", id: "membership-one" }),
        membership({ displayName: "Mobility Crew", id: "membership-two" }),
      ],
    });

    await expect(requestHostedGroupAssistantAsk({
      memberId: ORIGIN_MEMBER_ID,
      now: NOW,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      originSessionId: ORIGIN_SESSION_ID,
      prisma: prisma as never,
      question: QUESTION,
    })).resolves.toEqual({
      mailboxWake: null,
      result: {
        groupLabels: ["100 Club", "Mobility Crew"],
        status: "clarification_required",
      },
    });
    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).not.toHaveBeenCalled();
  });

  it("reports no groups without manufacturing a destination", async () => {
    const { prisma } = createPrisma({ memberships: [] });

    await expect(requestHostedGroupAssistantAsk({
      memberId: ORIGIN_MEMBER_ID,
      now: NOW,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      originSessionId: ORIGIN_SESSION_ID,
      prisma: prisma as never,
      question: QUESTION,
    })).resolves.toEqual({
      mailboxWake: null,
      result: { status: "no_groups" },
    });
    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).not.toHaveBeenCalled();
  });

  it("fails closed when two memberships have the same normalized label", async () => {
    const { prisma } = createPrisma({
      memberships: [
        membership({ displayName: "100 Club", id: "membership-one" }),
        membership({ displayName: " 100   CLUB ", id: "membership-two" }),
      ],
    });

    await expect(requestHostedGroupAssistantAsk({
      groupLabel: "100 club",
      memberId: ORIGIN_MEMBER_ID,
      now: NOW,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      originSessionId: ORIGIN_SESSION_ID,
      prisma: prisma as never,
      question: QUESTION,
    })).resolves.toEqual({
      mailboxWake: null,
      result: { status: "unavailable", unavailableReason: "ambiguous_group_label" },
    });
    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).not.toHaveBeenCalled();
  });

  it("rejects synthetic callers before membership resolution", async () => {
    const { prisma, tx } = createPrisma({ syntheticOrigin: true });

    await expect(requestHostedGroupAssistantAsk({
      memberId: ORIGIN_MEMBER_ID,
      now: NOW,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      originSessionId: ORIGIN_SESSION_ID,
      prisma: prisma as never,
      question: QUESTION,
    })).resolves.toEqual({
      mailboxWake: null,
      result: { status: "unavailable", unavailableReason: "origin_unavailable" },
    });
    expect(tx.hostedGroupMember.findMany).not.toHaveBeenCalled();
  });

  it("pins retries to the first normalized selector and question", async () => {
    const wake = requestWake();
    const { prisma, tx } = createPrisma();
    mocks.readHostedMailboxItemById.mockResolvedValue(mailboxItemForWake(wake));
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue(wake);

    await expect(requestHostedGroupAssistantAsk({
      groupLabel: "Mobility Crew",
      memberId: ORIGIN_MEMBER_ID,
      now: NOW,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      originSessionId: ORIGIN_SESSION_ID,
      prisma: prisma as never,
      question: QUESTION,
    })).resolves.toEqual({
      mailboxWake: null,
      result: { status: "unavailable", unavailableReason: "request_conflict" },
    });
    expect(tx.hostedGroupMember.findMany).not.toHaveBeenCalled();
    expect(tx.hostedGroupMember.findUnique).not.toHaveBeenCalled();
  });

  it("replays the exact request against its pinned membership without resolving again", async () => {
    const wake = requestWake();
    const { prisma, tx } = createPrisma();
    mocks.readHostedMailboxItemById.mockResolvedValue(mailboxItemForWake(wake));
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue(wake);

    await expect(requestHostedGroupAssistantAsk({
      memberId: ORIGIN_MEMBER_ID,
      now: NOW,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      originSessionId: ORIGIN_SESSION_ID,
      prisma: prisma as never,
      question: QUESTION,
    })).resolves.toEqual({
      mailboxWake: {
        expectedUserId: TARGET_RUNTIME_MEMBER_ID,
        mailboxItemId: wake.eventId,
      },
      result: { status: "accepted", targetLabel: "100 Club" },
    });
    expect(tx.hostedGroupMember.findMany).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).not.toHaveBeenCalled();
  });

  it("rejects a non-direct origin even when it has a valid membership", async () => {
    const nonDirect = directOriginWake();
    nonDirect.message.linqMessage.threadIsDirect = false;
    mocks.readHostedMailboxConversationWakeByAssistantInputId.mockResolvedValue(
      nonDirect,
    );
    const { prisma, tx } = createPrisma();

    await expect(requestHostedGroupAssistantAsk({
      memberId: ORIGIN_MEMBER_ID,
      now: NOW,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      originSessionId: ORIGIN_SESSION_ID,
      prisma: prisma as never,
      question: QUESTION,
    })).resolves.toEqual({
      mailboxWake: null,
      result: { status: "unavailable", unavailableReason: "origin_unavailable" },
    });
    expect(tx.hostedGroupMember.findMany).not.toHaveBeenCalled();
  });
});

describe("Hosted private-to-group context handoff admission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readHostedMailboxItemById.mockResolvedValue(null);
    mocks.readHostedMailboxConversationWakeByAssistantInputId.mockResolvedValue(
      directOriginWake(),
    );
    mocks.requireHostedRuntimeActiveAccess.mockResolvedValue(undefined);
    mocks.requireHostedRuntimeActiveAccessForUpdateTx.mockResolvedValue(undefined);
    const destination = groupDestination();
    mocks.resolveHostedAssistantNotificationDestination.mockResolvedValue(
      destination.destination,
    );
    mocks.bindHostedAssistantNotificationDestination.mockReturnValue(
      destination.bound,
    );
    mocks.assertHostedThreadRouteEgressAuthority.mockResolvedValue({});
    mocks.runWithPreparedHostedMailboxItemAppendCrypto.mockImplementation(
      async (input: {
        append: (prepared: object) => Promise<unknown>;
        prepareExisting?: () => Promise<void>;
      }) => {
        await input.prepareExisting?.();
        return input.append({
          domain: "mailbox-payload",
          rootKeyId: "root-key",
          userId: TARGET_RUNTIME_MEMBER_ID,
        });
      },
    );
    mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx.mockImplementation(
      async (input: { envelope: { eventId: string; userId: string } }) => ({
        dedupeConflict: false,
        duplicate: false,
        inserted: true,
        item: {
          id: input.envelope.eventId,
          userId: input.envelope.userId,
        },
      }),
    );
  });

  it("queues one expiring target-authored notification for the only group", async () => {
    const { prisma } = createPrisma();
    const context = "Sunny logged a 405 lb deadlift personal record today.";
    const eventId = createHostedGroupContextHandoffEventId({
      memberId: ORIGIN_MEMBER_ID,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
    });

    await expect(requestHostedGroupContextHandoff({
      context: `  ${context}  `,
      memberId: ORIGIN_MEMBER_ID,
      now: NOW,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      prisma: prisma as never,
    })).resolves.toEqual({
      mailboxWake: {
        expectedUserId: TARGET_RUNTIME_MEMBER_ID,
        mailboxItemId: eventId,
      },
      result: { status: "accepted", targetLabel: "100 Club" },
    });

    expect(mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx)
      .toHaveBeenCalledWith({
        envelope: expect.objectContaining({
          eventId,
          kind: "assistant.notification.requested",
          notification: {
            deliveryDedupeToken: eventId,
            deliveryDispatchMode: "queue-only",
            deliveryIdempotencyKey: eventId,
            externalThreadRouteAuthority: expect.objectContaining({
              containerMemberId: TARGET_RUNTIME_MEMBER_ID,
              threadId: "linq-group-chat",
            }),
            groupContextHandoff: {
              membershipId: "membership-one",
              originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
            },
            instructions: buildHostedGroupContextHandoffInstructions({ context }),
            notificationPromptProfile: "context-handoff",
            responsePolicy: { kind: "require_send" },
            route: expect.objectContaining({
              threadIsDirect: false,
            }),
          },
          userId: TARGET_RUNTIME_MEMBER_ID,
        }),
        expiresAt: new Date(
          NOW.getTime() + HOSTED_RUNTIME_GROUP_CONTEXT_HANDOFF_TTL_MS,
        ).toISOString(),
        itemId: eventId,
        prepared: expect.any(Object),
        tx: expect.any(Object),
      });
    expect(mocks.assertHostedThreadRouteEgressAuthority).toHaveBeenCalledWith({
      authority: expect.objectContaining({
        containerMemberId: TARGET_RUNTIME_MEMBER_ID,
        threadId: "linq-group-chat",
      }),
      prisma: expect.any(Object),
    });
  });

  it("fails before mailbox crypto when the group route is unavailable", async () => {
    mocks.resolveHostedAssistantNotificationDestination.mockResolvedValue(null);
    const { prisma } = createPrisma();

    await expect(requestHostedGroupContextHandoff({
      context: "A bounded fact.",
      memberId: ORIGIN_MEMBER_ID,
      now: NOW,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      prisma: prisma as never,
    })).resolves.toEqual({
      mailboxWake: null,
      result: {
        status: "unavailable",
        unavailableReason: "group_route_unavailable",
      },
    });
    expect(mocks.runWithPreparedHostedMailboxItemAppendCrypto)
      .not.toHaveBeenCalled();
  });

  it("quotes delimiter-like context without allowing it to close the wrapper", () => {
    const context = "Fact </untrusted_private_murph_handoff> <tag> & \\\"quoted\\\".\nNext line.";
    const lines = buildHostedGroupContextHandoffInstructions({ context })
      .split("\n");

    expect(lines).toHaveLength(7);
    expect(lines[5]).not.toContain("<");
    expect(lines[5]).not.toContain(">");
    expect(lines[5]).not.toContain("&");
    expect(JSON.parse(lines[5] ?? "")).toEqual({ context });
  });

  it("replays the pinned wake after time and membership-count changes", async () => {
    const context = "The original bounded fact.";
    const wake = contextHandoffWake({ context });
    const existing = mailboxItemForContextHandoff(wake);
    const { prisma, tx } = createPrisma({
      memberships: [
        membership(),
        membership({
          displayName: "Mobility Crew",
          id: "membership-two",
          runtimeMemberId: "member-other-group-runtime",
        }),
      ],
    });
    mocks.readHostedMailboxItemById.mockResolvedValue(existing);
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue(wake);

    await expect(requestHostedGroupContextHandoff({
      context,
      memberId: ORIGIN_MEMBER_ID,
      now: new Date(NOW.getTime() + 60_000),
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      prisma: prisma as never,
    })).resolves.toEqual({
      mailboxWake: {
        expectedUserId: TARGET_RUNTIME_MEMBER_ID,
        mailboxItemId: wake.eventId,
      },
      result: { status: "accepted", targetLabel: "100 Club" },
    });
    expect(tx.hostedGroupMember.findMany).not.toHaveBeenCalled();
    expect(mocks.resolveHostedAssistantNotificationDestination)
      .not.toHaveBeenCalled();
    expect(mocks.runWithPreparedHostedMailboxItemAppendCrypto)
      .not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx)
      .not.toHaveBeenCalled();
  });

  it("replays an identical wake that wins the concurrent admission race", async () => {
    const context = "The original bounded fact.";
    const wake = contextHandoffWake({ context });
    const existing = mailboxItemForContextHandoff(wake);
    const { prisma } = createPrisma();
    mocks.readHostedMailboxItemById
      .mockResolvedValueOnce(null)
      .mockResolvedValue(existing);
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue(wake);

    await expect(requestHostedGroupContextHandoff({
      context,
      memberId: ORIGIN_MEMBER_ID,
      now: NOW,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      prisma: prisma as never,
    })).resolves.toEqual({
      mailboxWake: {
        expectedUserId: TARGET_RUNTIME_MEMBER_ID,
        mailboxItemId: wake.eventId,
      },
      result: { status: "accepted", targetLabel: "100 Club" },
    });
    expect(mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx)
      .not.toHaveBeenCalled();
  });

  it("rejects replay after the pinned route loses egress authority", async () => {
    const context = "The original bounded fact.";
    const wake = contextHandoffWake({ context });
    const { prisma } = createPrisma();
    mocks.readHostedMailboxItemById.mockResolvedValue(
      mailboxItemForContextHandoff(wake),
    );
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue(wake);
    mocks.assertHostedThreadRouteEgressAuthority.mockRejectedValue(
      hostedOnboardingError({
        code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
        httpStatus: 403,
        message: "The pinned route is no longer authorized.",
        retryable: false,
      }),
    );

    await expect(requestHostedGroupContextHandoff({
      context,
      memberId: ORIGIN_MEMBER_ID,
      now: NOW,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      prisma: prisma as never,
    })).resolves.toEqual({
      mailboxWake: null,
      result: {
        status: "unavailable",
        unavailableReason: "group_route_unavailable",
      },
    });
  });

  it("conflicts when a replay changes the context or selects another target", async () => {
    const context = "The original bounded fact.";
    const wake = contextHandoffWake({ context });
    const existing = mailboxItemForContextHandoff(wake);
    const otherMembership = membership({
      displayName: "Mobility Crew",
      id: "membership-two",
      runtimeMemberId: "member-other-group-runtime",
    });
    const { prisma } = createPrisma({
      memberships: [membership(), otherMembership],
    });
    mocks.readHostedMailboxItemById.mockResolvedValue(existing);
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue(wake);

    await expect(requestHostedGroupContextHandoff({
      context: "Changed context must not redirect the same accepted input.",
      memberId: ORIGIN_MEMBER_ID,
      now: NOW,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      prisma: prisma as never,
    })).resolves.toEqual({
      mailboxWake: null,
      result: { status: "unavailable", unavailableReason: "request_conflict" },
    });

    await expect(requestHostedGroupContextHandoff({
      context,
      groupLabel: "Mobility Crew",
      memberId: ORIGIN_MEMBER_ID,
      now: NOW,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      prisma: prisma as never,
    })).resolves.toEqual({
      mailboxWake: null,
      result: { status: "unavailable", unavailableReason: "request_conflict" },
    });
    expect(mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx)
      .not.toHaveBeenCalled();
  });

  it("fails closed when the selected membership generation changes before append", async () => {
    const { prisma, tx } = createPrisma();
    tx.hostedGroupMember.findUnique
      .mockResolvedValueOnce(membership())
      .mockResolvedValueOnce(null);

    await expect(requestHostedGroupContextHandoff({
      context: "A bounded fact.",
      memberId: ORIGIN_MEMBER_ID,
      now: NOW,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      prisma: prisma as never,
    })).resolves.toEqual({
      mailboxWake: null,
      result: {
        status: "unavailable",
        unavailableReason: "membership_unavailable",
      },
    });
    expect(mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx)
      .not.toHaveBeenCalled();
  });
});

describe("Hosted Assistant Ask runtime control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readHostedMailboxConversationWakeByAssistantInputId.mockResolvedValue(
      directOriginWake(),
    );
    mocks.requireHostedRuntimeActiveAccessForUpdateTx.mockResolvedValue(undefined);
  });

  it("prepares only the exact live membership generation for its bound runtime", async () => {
    const wake = requestWake();
    const { prisma } = createPrisma();
    mocks.readHostedMailboxItemById.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => input.mailboxItemId === wake.eventId ? mailboxItemForWake(wake) : null);
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue(wake);

    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: TARGET_RUNTIME_MEMBER_ID,
      now: NOW,
      prisma: prisma as never,
      request: { action: "prepare", requestId: wake.eventId },
    })).resolves.toEqual({
      mailboxWake: null,
      response: {
        action: "prepare",
        question: QUESTION,
        status: "ready",
        targetLabel: "100 Club",
      },
    });
  });

  it("treats an expired non-current-sender request as terminal without membership lookup", async () => {
    const wake = requestWake();
    mocks.readHostedMailboxItemById.mockResolvedValue({
      ...mailboxItemForWake(wake),
      expiresAt: NOW.toISOString(),
    });
    mocks.readHostedMailboxWakeByDedupeKey.mockResolvedValue(wake);
    const { prisma, tx } = createPrisma();

    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: TARGET_RUNTIME_MEMBER_ID,
      now: NOW,
      prisma: prisma as never,
      request: { action: "prepare", requestId: wake.eventId },
    })).resolves.toEqual({
      mailboxWake: null,
      response: {
        action: "prepare",
        status: "terminal",
        terminalReason: "expired",
      },
    });
    expect(mocks.readHostedMailboxWakeByDedupeKey).toHaveBeenCalledOnce();
    expect(mocks.readHostedMailboxWakeByItemId).not.toHaveBeenCalled();
    expect(tx.hostedGroupMember.findUnique).not.toHaveBeenCalled();
  });

  it("does not disclose a request to a different bound runtime", async () => {
    const wake = requestWake();
    mocks.readHostedMailboxItemById.mockResolvedValue(mailboxItemForWake(wake));
    const { prisma, tx } = createPrisma();

    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: "member-other-runtime",
      now: NOW,
      prisma: prisma as never,
      request: { action: "prepare", requestId: wake.eventId },
    })).resolves.toEqual({
      mailboxWake: null,
      response: {
        action: "prepare",
        status: "terminal",
        terminalReason: "unavailable",
      },
    });
    expect(mocks.readHostedMailboxWakeByItemId).not.toHaveBeenCalled();
    expect(tx.hostedGroupMember.findUnique).not.toHaveBeenCalled();
  });

  it("does not rerun a prepared model after its completion was already committed", async () => {
    const wake = requestWake();
    const completionId = createHostedAssistantAskCompletionId(wake.eventId);
    const completionWake = buildHostedExecutionAssistantAskCompletedWake({
      ask: {
        expiresAt: wake.ask.expiresAt,
        originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
        originSessionId: ORIGIN_SESSION_ID,
        question: QUESTION,
        requestId: wake.eventId,
        result: { answer: "Committed answer.", outcome: "answered" },
        targetLabel: "100 Club",
      },
      eventId: completionId,
      memberId: ORIGIN_MEMBER_ID,
      occurredAt: NOW.toISOString(),
    });
    const { prisma } = createPrisma();
    mocks.readHostedMailboxItemById.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => input.mailboxItemId === wake.eventId
      ? mailboxItemForWake(wake)
      : {
          dedupeKey: completionId,
          expiresAt: wake.ask.expiresAt,
          id: completionId,
          kind: "assistant.ask.completed",
          userId: ORIGIN_MEMBER_ID,
        });
    mocks.readHostedMailboxWakeByItemId.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => input.mailboxItemId === wake.eventId ? wake : completionWake);

    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: TARGET_RUNTIME_MEMBER_ID,
      now: NOW,
      prisma: prisma as never,
      request: { action: "prepare", requestId: wake.eventId },
    })).resolves.toEqual({
      mailboxWake: {
        expectedUserId: ORIGIN_MEMBER_ID,
        mailboxItemId: completionId,
      },
      response: {
        action: "prepare",
        status: "terminal",
        terminalReason: "unavailable",
      },
    });
    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).not.toHaveBeenCalled();
  });

  it("appends one completion to the private origin with the exact question and expiry", async () => {
    const wake = requestWake();
    const completionId = createHostedAssistantAskCompletionId(wake.eventId);
    const { prisma } = createPrisma();
    mocks.readHostedMailboxItemById.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => input.mailboxItemId === wake.eventId ? mailboxItemForWake(wake) : null);
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue(wake);
    mocks.appendHostedMailboxEnvelopeWithIdentityTx.mockImplementation(
      async (input: { envelope: { eventId: string; userId: string } }) => ({
        dedupeConflict: false,
        duplicate: false,
        inserted: true,
        item: { id: input.envelope.eventId, userId: input.envelope.userId },
      }),
    );

    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: TARGET_RUNTIME_MEMBER_ID,
      now: NOW,
      prisma: prisma as never,
      request: {
        action: "complete",
        requestId: wake.eventId,
        result: { answer: "Three sets of squats.", outcome: "answered" },
      },
    })).resolves.toEqual({
      mailboxWake: {
        expectedUserId: ORIGIN_MEMBER_ID,
        mailboxItemId: completionId,
      },
      response: { action: "complete", status: "completed" },
    });

    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        ask: {
          expiresAt: wake.ask.expiresAt,
          originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
          originSessionId: ORIGIN_SESSION_ID,
          question: QUESTION,
          requestId: wake.eventId,
          result: { answer: "Three sets of squats.", outcome: "answered" },
          targetLabel: "100 Club",
        },
        eventId: completionId,
        kind: "assistant.ask.completed",
        userId: ORIGIN_MEMBER_ID,
      }),
      expiresAt: wake.ask.expiresAt,
      itemId: completionId,
      tx: expect.any(Object),
    });
  });

  it("fails closed when the membership generation no longer belongs to the origin", async () => {
    const wake = requestWake();
    const changedMembership = membership({ memberId: "member-other" });
    const { prisma } = createPrisma({ selectedMembership: changedMembership });
    mocks.readHostedMailboxItemById.mockResolvedValue(mailboxItemForWake(wake));
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue(wake);

    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: TARGET_RUNTIME_MEMBER_ID,
      now: NOW,
      prisma: prisma as never,
      request: { action: "prepare", requestId: wake.eventId },
    })).resolves.toEqual({
      mailboxWake: null,
      response: {
        action: "prepare",
        status: "terminal",
        terminalReason: "unavailable",
      },
    });
  });

  it("fails closed after leave and rejoin creates a new membership generation", async () => {
    const wake = requestWake({ membershipId: "membership-old" });
    const { prisma } = createPrisma({ selectedMembership: null });
    mocks.readHostedMailboxItemById.mockResolvedValue(mailboxItemForWake(wake));
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue(wake);

    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: TARGET_RUNTIME_MEMBER_ID,
      now: NOW,
      prisma: prisma as never,
      request: { action: "prepare", requestId: wake.eventId },
    })).resolves.toEqual({
      mailboxWake: null,
      response: {
        action: "prepare",
        status: "terminal",
        terminalReason: "unavailable",
      },
    });
  });

  it("keeps the first completion and re-wakes its origin after a lost first wake", async () => {
    const wake = requestWake();
    const completionId = createHostedAssistantAskCompletionId(wake.eventId);
    const completionWake = buildHostedExecutionAssistantAskCompletedWake({
      ask: {
        expiresAt: wake.ask.expiresAt,
        originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
        originSessionId: ORIGIN_SESSION_ID,
        question: QUESTION,
        requestId: wake.eventId,
        result: { answer: "First answer.", outcome: "answered" },
        targetLabel: "100 Club",
      },
      eventId: completionId,
      memberId: ORIGIN_MEMBER_ID,
      occurredAt: NOW.toISOString(),
    });
    const { prisma } = createPrisma();
    mocks.readHostedMailboxItemById.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => input.mailboxItemId === wake.eventId
      ? mailboxItemForWake(wake)
      : {
          dedupeKey: completionId,
          expiresAt: wake.ask.expiresAt,
          id: completionId,
          kind: "assistant.ask.completed",
          userId: ORIGIN_MEMBER_ID,
        });
    mocks.readHostedMailboxWakeByItemId.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => input.mailboxItemId === wake.eventId ? wake : completionWake);

    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: TARGET_RUNTIME_MEMBER_ID,
      now: NOW,
      prisma: prisma as never,
      request: {
        action: "complete",
        requestId: wake.eventId,
        result: { answer: "Different retry answer.", outcome: "answered" },
      },
    })).resolves.toEqual({
      mailboxWake: {
        expectedUserId: ORIGIN_MEMBER_ID,
        mailboxItemId: completionId,
      },
      response: { action: "complete", status: "already_completed" },
    });
    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).not.toHaveBeenCalled();
  });
});
