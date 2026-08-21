import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeWithIdentityTx: vi.fn(),
  appendHostedMailboxEnvelopeWithPreparedCryptoTx: vi.fn(),
  assertHostedLinqRouteEgressAuthority: vi.fn(),
  assertHostedThreadRouteEgressAuthority: vi.fn(),
  readHostedGroupDisclosureGrantAuthorityTx: vi.fn(),
  readHostedMailboxConversationWakeByAssistantInputId: vi.fn(),
  readHostedMailboxItemById: vi.fn(),
  readHostedMailboxWakeByDedupeKey: vi.fn(),
  readHostedMailboxWakeByItemId: vi.fn(),
  requireHostedRuntimeActiveAccess: vi.fn(),
  requireHostedRuntimeActiveAccessForUpdateTx: vi.fn(),
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

vi.mock("@/src/lib/hosted-groups/group-disclosure-store", () => ({
  readHostedGroupDisclosureGrantAuthorityTx:
    mocks.readHostedGroupDisclosureGrantAuthorityTx,
}));

vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  assertHostedLinqRouteEgressAuthority:
    mocks.assertHostedLinqRouteEgressAuthority,
  assertHostedThreadRouteEgressAuthority:
    mocks.assertHostedThreadRouteEgressAuthority,
}));

import {
  assertHostedAssistantAskCompletionDeliveryAuthorityTx,
  createHostedAssistantAskCompletionId,
  createHostedGroupMemberAssistantAskRequestId,
  handleHostedRuntimeAssistantAskControl,
  requestHostedGroupMemberAssistantAsk,
} from "@/src/lib/hosted-groups/group-assistant-ask";
import { HostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  buildHostedExecutionAssistantAskCompletedWake,
  buildHostedExecutionAssistantAskRequestedWake,
  createHostedExecutionReviewedAssistantAskCompletionDeliveryKey,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
} from "@murphai/hosted-execution/contracts";

const NOW = new Date("2026-07-16T12:00:00.000Z");
const GROUP_RUNTIME_MEMBER_ID = "member-group-runtime";
const TARGET_MEMBER_ID = "member-personal";
const ORIGIN_ASSISTANT_INPUT_ID = `ain_${"b".repeat(32)}`;
const ORIGIN_SESSION_ID = "session_group";
const ACCEPTED_ORIGIN = {
  assistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
  kind: "accepted_input" as const,
  sessionId: ORIGIN_SESSION_ID,
};
const SCHEDULED_ORIGIN = {
  automationId: "automation_call_circle",
  kind: "automation_occurrence" as const,
  occurrenceAt: NOW.toISOString(),
};
const GRANT_ID = "hgrpdg_current";
const MEMBERSHIP_ID = "hgrpm_current";
const PERMISSION_DIGEST = "d".repeat(64);
const PERMISSION_TEXT =
  "Share my calendar availability only for coordinating a call with this group.";
const QUESTION = "Which times work for a call tomorrow?";
function disclosureAuthority() {
  return {
    grantId: GRANT_ID,
    grantedAt: NOW,
    groupId: "group-current",
    groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
    membershipId: MEMBERSHIP_ID,
    permissionDigest: PERMISSION_DIGEST,
    permissionId: "hgrpdp_current",
    permissionText: PERMISSION_TEXT,
    targetMemberId: TARGET_MEMBER_ID,
  };
}

function groupOriginWake(input: {
  includeRouteAuthority?: boolean;
  threadIsDirect?: boolean;
} = {}) {
  return {
    eventId: "origin-group-event",
    kind: "conversation.message" as const,
    message: {
      channel: "linq" as const,
      contactKind: "phone" as const,
      contactLookupKey: "contact-lookup",
      linqMessage: {
        chatId: "chat-current-group",
        from: "+15550001111",
        isFromMe: false,
        messageId: "origin-message",
        parts: [{ text: QUESTION, type: "text" as const }],
        threadIsDirect: input.threadIsDirect ?? false,
      },
      ...(input.includeRouteAuthority === false
        ? {}
        : {
            routeAuthority: {
              channel: "linq" as const,
              containerMemberId: GROUP_RUNTIME_MEMBER_ID,
              threadId: "chat-current-group",
            },
          }),
    },
    occurredAt: NOW.toISOString(),
    userId: GROUP_RUNTIME_MEMBER_ID,
  };
}

function disclosureRequestWake() {
  const requestId = createHostedGroupMemberAssistantAskRequestId({
    grantId: GRANT_ID,
    groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
    origin: ACCEPTED_ORIGIN,
  });
  return buildHostedExecutionAssistantAskRequestedWake({
    ask: {
      expiresAt: new Date(
        NOW.getTime() + HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
      ).toISOString(),
      origin: ACCEPTED_ORIGIN,
      question: QUESTION,
      target: {
        grantId: GRANT_ID,
        kind: "consented_member",
        membershipId: MEMBERSHIP_ID,
        permissionDigest: PERMISSION_DIGEST,
      },
    },
    eventId: requestId,
    memberId: TARGET_MEMBER_ID,
    occurredAt: NOW.toISOString(),
  });
}

function scheduledDisclosureRequestWake() {
  const requestId = createHostedGroupMemberAssistantAskRequestId({
    grantId: GRANT_ID,
    groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
    origin: SCHEDULED_ORIGIN,
  });
  return buildHostedExecutionAssistantAskRequestedWake({
    ask: {
      expiresAt: new Date(
        NOW.getTime() + HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
      ).toISOString(),
      origin: SCHEDULED_ORIGIN,
      question: QUESTION,
      target: {
        grantId: GRANT_ID,
        kind: "consented_member",
        membershipId: MEMBERSHIP_ID,
        permissionDigest: PERMISSION_DIGEST,
      },
    },
    eventId: requestId,
    memberId: TARGET_MEMBER_ID,
    occurredAt: NOW.toISOString(),
  });
}

function reviewedCompletionWake(
  requestWake: ReturnType<typeof disclosureRequestWake>,
) {
  return buildHostedExecutionAssistantAskCompletedWake({
    ask: {
      expiresAt: requestWake.ask.expiresAt,
      origin: ACCEPTED_ORIGIN,
      question: QUESTION,
      requestId: requestWake.eventId,
      result: { answer: "Tomorrow at 3pm works.", outcome: "answered" },
      targetLabel: null,
    },
    eventId: createHostedAssistantAskCompletionId(requestWake.eventId),
    memberId: GROUP_RUNTIME_MEMBER_ID,
    occurredAt: NOW.toISOString(),
  });
}

function scheduledCompletionWake(
  requestWake: ReturnType<typeof scheduledDisclosureRequestWake>,
) {
  return buildHostedExecutionAssistantAskCompletedWake({
    ask: {
      expiresAt: requestWake.ask.expiresAt,
      origin: SCHEDULED_ORIGIN,
      question: QUESTION,
      requestId: requestWake.eventId,
      result: { answer: "Tomorrow at 3pm works.", outcome: "answered" },
      targetLabel: null,
    },
    eventId: createHostedAssistantAskCompletionId(requestWake.eventId),
    memberId: GROUP_RUNTIME_MEMBER_ID,
    occurredAt: NOW.toISOString(),
  });
}

function mailboxItemForWake(input: {
  eventId: string;
  kind: string;
  userId: string;
  ask: { expiresAt: string };
}) {
  return {
    dedupeKey: input.eventId,
    expiresAt: input.ask.expiresAt,
    id: input.eventId,
    kind: input.kind,
    userId: input.userId,
  };
}

function createPrisma() {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    hostedThreadContainer: {
      findUnique: vi.fn(async (input: { where: { memberId: string } }) =>
        input.where.memberId === GROUP_RUNTIME_MEMBER_ID
          ? { memberId: GROUP_RUNTIME_MEMBER_ID }
          : null),
    },
  };
  let transactionTail = Promise.resolve();
  return {
    prisma: {
      $transaction: vi.fn((run: (transaction: typeof tx) => Promise<unknown>) => {
        const result = transactionTail.then(() => run(tx));
        transactionTail = result.then(() => undefined, () => undefined);
        return result;
      }),
    },
    tx,
  };
}

function requestDisclosure(
  prisma: ReturnType<typeof createPrisma>["prisma"],
  overrides: Partial<Omit<
    Parameters<typeof requestHostedGroupMemberAssistantAsk>[0],
    "prisma"
  >> = {},
) {
  return requestHostedGroupMemberAssistantAsk({
    grantId: GRANT_ID,
    memberId: GROUP_RUNTIME_MEMBER_ID,
    now: NOW,
    origin: ACCEPTED_ORIGIN,
    question: QUESTION,
    ...overrides,
    prisma: prisma as never,
  });
}

describe("Hosted consented group-to-member Assistant Ask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readHostedMailboxItemById.mockResolvedValue(null);
    mocks.readHostedMailboxConversationWakeByAssistantInputId.mockResolvedValue(
      groupOriginWake(),
    );
    mocks.readHostedGroupDisclosureGrantAuthorityTx.mockResolvedValue(
      disclosureAuthority(),
    );
    mocks.requireHostedRuntimeActiveAccess.mockResolvedValue(undefined);
    mocks.requireHostedRuntimeActiveAccessForUpdateTx.mockResolvedValue(undefined);
    mocks.assertHostedLinqRouteEgressAuthority.mockResolvedValue({});
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
  });

  it("pins the exact current grant generation before waking the personal runtime", async () => {
    const { prisma } = createPrisma();
    const requestId = createHostedGroupMemberAssistantAskRequestId({
      grantId: GRANT_ID,
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      origin: ACCEPTED_ORIGIN,
    });

    await expect(requestDisclosure(prisma, {
      grantId: `  ${GRANT_ID}  `,
      question: ` ${QUESTION} `,
    })).resolves.toEqual({
      mailboxWake: {
        expectedUserId: TARGET_MEMBER_ID,
        mailboxItemId: requestId,
      },
      result: { status: "accepted" },
    });

    expect(mocks.readHostedGroupDisclosureGrantAuthorityTx).toHaveBeenCalledWith({
      expectedGroupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      grantId: GRANT_ID,
      tx: expect.any(Object),
    });
    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        ask: expect.objectContaining({
          question: QUESTION,
          target: {
            grantId: GRANT_ID,
            kind: "consented_member",
            membershipId: MEMBERSHIP_ID,
            permissionDigest: PERMISSION_DIGEST,
          },
        }),
        eventId: requestId,
        userId: TARGET_MEMBER_ID,
      }),
      expiresAt: new Date(
        NOW.getTime() + HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
      ).toISOString(),
      itemId: requestId,
      tx: expect.any(Object),
    });
  });

  it("locks the grant before rejecting an ineligible group origin", async () => {
    const { prisma } = createPrisma();
    mocks.readHostedMailboxConversationWakeByAssistantInputId.mockResolvedValue(
      groupOriginWake({ threadIsDirect: true }),
    );

    await expect(requestDisclosure(prisma)).resolves.toEqual({
      mailboxWake: null,
      result: { status: "unavailable", unavailableReason: "origin_unavailable" },
    });
    expect(mocks.readHostedGroupDisclosureGrantAuthorityTx).toHaveBeenCalledWith({
      expectedGroupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      grantId: GRANT_ID,
      tx: expect.any(Object),
    });
    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).not.toHaveBeenCalled();
  });

  it("does not admit a grant target that is itself a group container", async () => {
    const { prisma, tx } = createPrisma();
    tx.hostedThreadContainer.findUnique.mockImplementation(async (input) => ({
      memberId: input.where.memberId,
    }));

    await expect(requestDisclosure(prisma)).resolves.toEqual({
      mailboxWake: null,
      result: { status: "unavailable", unavailableReason: "grant_unavailable" },
    });
    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).not.toHaveBeenCalled();
  });

  it("admits one request per grant from the same trusted invocation", async () => {
    const secondGrantId = "hgrpdg_second";
    const { prisma, tx } = createPrisma();
    const storedWakes = new Map<string, ReturnType<typeof disclosureRequestWake>>();
    mocks.readHostedMailboxItemById.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => {
      const wake = storedWakes.get(input.mailboxItemId);
      return wake ? mailboxItemForWake(wake) : null;
    });
    mocks.readHostedMailboxWakeByItemId.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => storedWakes.get(input.mailboxItemId) ?? null);
    mocks.readHostedGroupDisclosureGrantAuthorityTx.mockImplementation(
      async (input: { grantId: string }) => ({
        ...disclosureAuthority(),
        grantId: input.grantId,
      }),
    );
    mocks.appendHostedMailboxEnvelopeWithIdentityTx.mockImplementation(
      async (input: { envelope: ReturnType<typeof disclosureRequestWake> }) => {
        storedWakes.set(input.envelope.eventId, input.envelope);
        return {
          dedupeConflict: false,
          duplicate: false,
          inserted: true,
          item: {
            id: input.envelope.eventId,
            userId: input.envelope.userId,
          },
        };
      },
    );

    const firstRequestId = createHostedGroupMemberAssistantAskRequestId({
      grantId: GRANT_ID,
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      origin: ACCEPTED_ORIGIN,
    });
    const secondRequestId = createHostedGroupMemberAssistantAskRequestId({
      grantId: secondGrantId,
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      origin: ACCEPTED_ORIGIN,
    });
    const request = (grantId: string) => requestDisclosure(prisma, { grantId });

    await expect(Promise.all([request(GRANT_ID), request(secondGrantId)]))
      .resolves.toEqual([
        {
          mailboxWake: {
            expectedUserId: TARGET_MEMBER_ID,
            mailboxItemId: firstRequestId,
          },
          result: { status: "accepted" },
        },
        {
          mailboxWake: {
            expectedUserId: TARGET_MEMBER_ID,
            mailboxItemId: secondRequestId,
          },
          result: { status: "accepted" },
        },
      ]);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(new Set(tx.$executeRaw.mock.calls.map((call) => call[2]))).toEqual(
      new Set([firstRequestId, secondRequestId]),
    );
    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).toHaveBeenCalledTimes(2);
  });

  it("allows the same grant again from a later scheduled occurrence", async () => {
    const laterOrigin = {
      ...SCHEDULED_ORIGIN,
      occurrenceAt: "2026-07-23T12:00:00.000Z",
    };
    const { prisma } = createPrisma();
    const requestId = createHostedGroupMemberAssistantAskRequestId({
      grantId: GRANT_ID,
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      origin: laterOrigin,
    });

    await expect(requestDisclosure(prisma, {
      origin: laterOrigin,
    })).resolves.toEqual({
      mailboxWake: {
        expectedUserId: TARGET_MEMBER_ID,
        mailboxItemId: requestId,
      },
      result: { status: "accepted" },
    });
    expect(mocks.readHostedMailboxConversationWakeByAssistantInputId)
      .not.toHaveBeenCalled();
  });

  it("propagates unexpected group-route failures for retry", async () => {
    const { prisma } = createPrisma();
    mocks.assertHostedLinqRouteEgressAuthority.mockRejectedValue(
      new Error("route authority lookup failed"),
    );

    await expect(requestDisclosure(prisma)).rejects.toThrow(
      "route authority lookup failed",
    );
    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).not.toHaveBeenCalled();
  });

  it("replays only the same grant, question, and session for one origin", async () => {
    const wake = disclosureRequestWake();
    const { prisma } = createPrisma();
    mocks.readHostedMailboxItemById.mockResolvedValue(mailboxItemForWake(wake));
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue(wake);

    await expect(requestDisclosure(prisma)).resolves.toEqual({
      mailboxWake: {
        expectedUserId: TARGET_MEMBER_ID,
        mailboxItemId: wake.eventId,
      },
      result: { status: "accepted" },
    });
    for (const overrides of [
      {
        origin: {
          ...ACCEPTED_ORIGIN,
          sessionId: "session_different",
        },
      },
      { question: "A different question" },
    ]) {
      await expect(requestDisclosure(prisma, overrides)).resolves.toEqual({
        mailboxWake: null,
        result: { status: "unavailable", unavailableReason: "request_conflict" },
      });
    }
    expect(mocks.readHostedGroupDisclosureGrantAuthorityTx).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).not.toHaveBeenCalled();
  });

  it("returns the exact permission only after revalidating the pinned grant", async () => {
    const wake = disclosureRequestWake();
    const { prisma } = createPrisma();
    mocks.readHostedMailboxItemById.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => input.mailboxItemId === wake.eventId ? mailboxItemForWake(wake) : null);
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue(wake);

    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: TARGET_MEMBER_ID,
      now: NOW,
      prisma: prisma as never,
      request: { action: "prepare", requestId: wake.eventId },
    })).resolves.toEqual({
      mailboxWake: null,
      response: {
        action: "prepare",
        disclosure: { permissionText: PERMISSION_TEXT },
        question: QUESTION,
        status: "ready",
        targetLabel: null,
      },
    });
    expect(mocks.readHostedGroupDisclosureGrantAuthorityTx).toHaveBeenCalledWith({
      expectedTargetMemberId: TARGET_MEMBER_ID,
      grantId: GRANT_ID,
      membershipId: MEMBERSHIP_ID,
      permissionDigest: PERMISSION_DIGEST,
      tx: expect.any(Object),
    });
  });

  it("fails closed when revocation wins before completion", async () => {
    const wake = disclosureRequestWake();
    const { prisma } = createPrisma();
    mocks.readHostedMailboxItemById.mockResolvedValue(mailboxItemForWake(wake));
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue(wake);
    mocks.readHostedGroupDisclosureGrantAuthorityTx.mockResolvedValue(null);

    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: TARGET_MEMBER_ID,
      now: NOW,
      prisma: prisma as never,
      request: {
        action: "complete",
        requestId: wake.eventId,
        result: { answer: "Tomorrow at 3pm works.", outcome: "answered" },
      },
    })).resolves.toEqual({
      mailboxWake: null,
      response: {
        action: "complete",
        status: "terminal",
        terminalReason: "unavailable",
      },
    });
    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).not.toHaveBeenCalled();
  });

  it("appends reviewed bytes to the exact group origin without another model mode", async () => {
    const wake = disclosureRequestWake();
    const completionId = createHostedAssistantAskCompletionId(wake.eventId);
    const { prisma } = createPrisma();
    mocks.readHostedMailboxItemById.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => input.mailboxItemId === wake.eventId ? mailboxItemForWake(wake) : null);
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue(wake);

    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: TARGET_MEMBER_ID,
      now: NOW,
      prisma: prisma as never,
      request: {
        action: "complete",
        requestId: wake.eventId,
        result: { answer: "Tomorrow at 3pm works.", outcome: "answered" },
      },
    })).resolves.toEqual({
      mailboxWake: {
        expectedUserId: GROUP_RUNTIME_MEMBER_ID,
        mailboxItemId: completionId,
      },
      response: { action: "complete", status: "completed" },
    });
    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        ask: expect.objectContaining({
          origin: ACCEPTED_ORIGIN,
          requestId: wake.eventId,
          result: { answer: "Tomorrow at 3pm works.", outcome: "answered" },
        }),
        eventId: completionId,
        userId: GROUP_RUNTIME_MEMBER_ID,
      }),
      expiresAt: wake.ask.expiresAt,
      itemId: completionId,
      tx: expect.any(Object),
    });
  });

  it("stores a scheduled result for the current turn to read", async () => {
    const wake = scheduledDisclosureRequestWake();
    const completionId = createHostedAssistantAskCompletionId(wake.eventId);
    const { prisma } = createPrisma();
    mocks.readHostedMailboxItemById.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => input.mailboxItemId === wake.eventId ? mailboxItemForWake(wake) : null);
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue(wake);

    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: TARGET_MEMBER_ID,
      now: NOW,
      prisma: prisma as never,
      request: {
        action: "complete",
        requestId: wake.eventId,
        result: { answer: "Tomorrow at 3pm works.", outcome: "answered" },
      },
    })).resolves.toEqual({
      mailboxWake: null,
      response: { action: "complete", status: "completed" },
    });
    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        ask: expect.objectContaining({
          origin: SCHEDULED_ORIGIN,
          requestId: wake.eventId,
          result: { answer: "Tomorrow at 3pm works.", outcome: "answered" },
        }),
        eventId: completionId,
        userId: GROUP_RUNTIME_MEMBER_ID,
      }),
      expiresAt: wake.ask.expiresAt,
      itemId: completionId,
      tx: expect.any(Object),
    });
    expect(mocks.readHostedMailboxConversationWakeByAssistantInputId)
      .not.toHaveBeenCalled();
  });

  it("returns a completed scheduled result when the same ask is repeated", async () => {
    const requestWake = scheduledDisclosureRequestWake();
    const completionWake = scheduledCompletionWake(requestWake);
    const { prisma } = createPrisma();
    mocks.readHostedMailboxItemById.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => input.mailboxItemId === requestWake.eventId
      ? mailboxItemForWake(requestWake)
      : input.mailboxItemId === completionWake.eventId
        ? mailboxItemForWake(completionWake)
        : null);
    mocks.readHostedMailboxWakeByItemId.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => input.mailboxItemId === requestWake.eventId
      ? requestWake
      : input.mailboxItemId === completionWake.eventId
        ? completionWake
        : null);

    await expect(requestDisclosure(prisma, {
      origin: SCHEDULED_ORIGIN,
    })).resolves.toEqual({
      mailboxWake: null,
      result: {
        answer: "Tomorrow at 3pm works.",
        outcome: "answered",
        status: "completed",
      },
    });
    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).not.toHaveBeenCalled();
  });

  it("does not return a stored scheduled result after the grant is revoked", async () => {
    const requestWake = scheduledDisclosureRequestWake();
    const completionWake = scheduledCompletionWake(requestWake);
    const { prisma } = createPrisma();
    mocks.readHostedMailboxItemById.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => input.mailboxItemId === requestWake.eventId
      ? mailboxItemForWake(requestWake)
      : input.mailboxItemId === completionWake.eventId
        ? mailboxItemForWake(completionWake)
        : null);
    mocks.readHostedMailboxWakeByItemId.mockResolvedValue(requestWake);
    mocks.readHostedGroupDisclosureGrantAuthorityTx.mockResolvedValue(null);

    await expect(requestDisclosure(prisma, {
      origin: SCHEDULED_ORIGIN,
    })).resolves.toEqual({
      mailboxWake: null,
      result: { status: "unavailable", unavailableReason: "grant_unavailable" },
    });
  });

  it("does not reveal a stored scheduled result after the group runtime fence is inactive", async () => {
    const requestWake = scheduledDisclosureRequestWake();
    const completionWake = scheduledCompletionWake(requestWake);
    const { prisma } = createPrisma();
    mocks.readHostedMailboxItemById.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => input.mailboxItemId === requestWake.eventId
      ? mailboxItemForWake(requestWake)
      : input.mailboxItemId === completionWake.eventId
        ? mailboxItemForWake(completionWake)
        : null);
    mocks.readHostedMailboxWakeByItemId.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => input.mailboxItemId === requestWake.eventId
      ? requestWake
      : input.mailboxItemId === completionWake.eventId
        ? completionWake
        : null);
    mocks.requireHostedRuntimeActiveAccessForUpdateTx.mockRejectedValueOnce(
      new HostedOnboardingError({
        code: "HOSTED_ASSISTANT_ASK_RUNTIME_INACTIVE",
        httpStatus: 403,
        message: "Hosted Assistant Ask runtime access is inactive.",
      }),
    );

    await expect(requestDisclosure(prisma, {
      origin: SCHEDULED_ORIGIN,
    })).resolves.toEqual({
      mailboxWake: null,
      result: { status: "unavailable", unavailableReason: "origin_unavailable" },
    });
    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).not.toHaveBeenCalled();
  });

  it("revalidates the exact live grant at provider dispatch entry", async () => {
    const requestWake = disclosureRequestWake();
    const completionWake = reviewedCompletionWake(requestWake);
    const { tx } = createPrisma();
    mocks.readHostedMailboxItemById.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => input.mailboxItemId === completionWake.eventId
      ? mailboxItemForWake(completionWake)
      : input.mailboxItemId === requestWake.eventId
        ? mailboxItemForWake(requestWake)
        : null);
    mocks.readHostedMailboxWakeByItemId.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => input.mailboxItemId === completionWake.eventId
      ? completionWake
      : input.mailboxItemId === requestWake.eventId
        ? requestWake
        : null);
    mocks.readHostedMailboxWakeByDedupeKey.mockResolvedValue(completionWake);

    await expect(assertHostedAssistantAskCompletionDeliveryAuthorityTx({
      answeredMailboxItemIds: [completionWake.eventId],
      assistantAskCompletionExpiresAt: completionWake.ask.expiresAt,
      assistantAskFallback: false,
      boundRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      idempotencyKey:
        createHostedExecutionReviewedAssistantAskCompletionDeliveryKey(
          completionWake.eventId,
        ),
      now: NOW,
      tx: tx as never,
    })).resolves.toBeUndefined();
    expect(mocks.readHostedGroupDisclosureGrantAuthorityTx).toHaveBeenCalledWith({
      expectedTargetMemberId: TARGET_MEMBER_ID,
      grantId: GRANT_ID,
      membershipId: MEMBERSHIP_ID,
      permissionDigest: PERMISSION_DIGEST,
      tx: expect.any(Object),
    });
  });

  it("rejects provider dispatch when the exact grant was revoked after completion", async () => {
    const requestWake = disclosureRequestWake();
    const completionWake = reviewedCompletionWake(requestWake);
    const { tx } = createPrisma();
    mocks.readHostedMailboxItemById.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => input.mailboxItemId === completionWake.eventId
      ? mailboxItemForWake(completionWake)
      : input.mailboxItemId === requestWake.eventId
        ? mailboxItemForWake(requestWake)
        : null);
    mocks.readHostedMailboxWakeByItemId.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => input.mailboxItemId === completionWake.eventId
      ? completionWake
      : input.mailboxItemId === requestWake.eventId
        ? requestWake
        : null);
    mocks.readHostedGroupDisclosureGrantAuthorityTx.mockResolvedValue(null);

    await expect(assertHostedAssistantAskCompletionDeliveryAuthorityTx({
      answeredMailboxItemIds: [completionWake.eventId],
      boundRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      idempotencyKey:
        createHostedExecutionReviewedAssistantAskCompletionDeliveryKey(
          completionWake.eventId,
        ),
      now: NOW,
      tx: tx as never,
    })).rejects.toMatchObject({
      code: "HOSTED_ASSISTANT_ASK_DELIVERY_AUTHORITY_MISMATCH",
      httpStatus: 403,
      retryable: false,
    });
  });

  it("requests the fixed fallback after revocation and then authorizes that exact copy", async () => {
    const requestWake = disclosureRequestWake();
    const completionWake = reviewedCompletionWake(requestWake);
    const { tx } = createPrisma();
    mocks.readHostedMailboxItemById.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => input.mailboxItemId === completionWake.eventId
      ? mailboxItemForWake(completionWake)
      : input.mailboxItemId === requestWake.eventId
        ? mailboxItemForWake(requestWake)
        : null);
    mocks.readHostedMailboxWakeByDedupeKey.mockResolvedValue(completionWake);
    mocks.readHostedGroupDisclosureGrantAuthorityTx.mockResolvedValue(null);
    const deliveryInput = {
      answeredMailboxItemIds: [completionWake.eventId],
      assistantAskCompletionExpiresAt: completionWake.ask.expiresAt,
      boundRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      idempotencyKey:
        createHostedExecutionReviewedAssistantAskCompletionDeliveryKey(
          completionWake.eventId,
        ),
      now: NOW,
      tx: tx as never,
    };

    await expect(assertHostedAssistantAskCompletionDeliveryAuthorityTx({
      ...deliveryInput,
      assistantAskFallback: false,
    })).resolves.toEqual({ assistantAskFallbackRequired: true });
    await expect(assertHostedAssistantAskCompletionDeliveryAuthorityTx({
      ...deliveryInput,
      assistantAskFallback: true,
    })).resolves.toBeUndefined();
    expect(mocks.readHostedGroupDisclosureGrantAuthorityTx).toHaveBeenCalledTimes(1);
  });

  it("recovers an expired structurally bound completion with only the fixed fallback", async () => {
    const requestWake = disclosureRequestWake();
    const completionWake = reviewedCompletionWake(requestWake);
    const { tx } = createPrisma();
    mocks.readHostedMailboxItemById.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => input.mailboxItemId === completionWake.eventId
      ? mailboxItemForWake(completionWake)
      : null);
    mocks.readHostedMailboxWakeByDedupeKey.mockResolvedValue(completionWake);
    const deliveryInput = {
      answeredMailboxItemIds: [completionWake.eventId],
      assistantAskCompletionExpiresAt: completionWake.ask.expiresAt,
      boundRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      idempotencyKey:
        createHostedExecutionReviewedAssistantAskCompletionDeliveryKey(
          completionWake.eventId,
        ),
      now: new Date(requestWake.ask.expiresAt),
      tx: tx as never,
    };

    await expect(assertHostedAssistantAskCompletionDeliveryAuthorityTx({
      ...deliveryInput,
      assistantAskFallback: false,
    })).resolves.toEqual({ assistantAskFallbackRequired: true });
    await expect(assertHostedAssistantAskCompletionDeliveryAuthorityTx({
      ...deliveryInput,
      assistantAskFallback: true,
    })).resolves.toBeUndefined();
    expect(mocks.readHostedMailboxWakeByItemId).not.toHaveBeenCalled();
  });

  it("recovers a content-retired completion with only the fixed fallback", async () => {
    const requestWake = disclosureRequestWake();
    const completionWake = reviewedCompletionWake(requestWake);
    const { tx } = createPrisma();
    mocks.readHostedMailboxItemById.mockResolvedValue({
      ...mailboxItemForWake(completionWake),
      payloadBytes: null,
      payloadHash: null,
      payloadInlineCiphertext: null,
      payloadRef: null,
    });
    const deliveryInput = {
      answeredMailboxItemIds: [completionWake.eventId],
      assistantAskCompletionExpiresAt: completionWake.ask.expiresAt,
      boundRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      idempotencyKey:
        createHostedExecutionReviewedAssistantAskCompletionDeliveryKey(
          completionWake.eventId,
        ),
      now: new Date(requestWake.ask.expiresAt),
      tx: tx as never,
    };

    await expect(assertHostedAssistantAskCompletionDeliveryAuthorityTx({
      ...deliveryInput,
      assistantAskFallback: false,
    })).resolves.toEqual({ assistantAskFallbackRequired: true });
    await expect(assertHostedAssistantAskCompletionDeliveryAuthorityTx({
      ...deliveryInput,
      assistantAskFallback: true,
    })).resolves.toBeUndefined();
    expect(mocks.readHostedMailboxWakeByDedupeKey).not.toHaveBeenCalled();
  });

  it("rejects provider dispatch when the request expired after completion", async () => {
    const requestWake = disclosureRequestWake();
    const completionWake = reviewedCompletionWake(requestWake);
    const { tx } = createPrisma();
    mocks.readHostedMailboxItemById.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => input.mailboxItemId === completionWake.eventId
      ? mailboxItemForWake(completionWake)
      : input.mailboxItemId === requestWake.eventId
        ? mailboxItemForWake(requestWake)
        : null);

    await expect(assertHostedAssistantAskCompletionDeliveryAuthorityTx({
      answeredMailboxItemIds: [completionWake.eventId],
      boundRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      idempotencyKey:
        createHostedExecutionReviewedAssistantAskCompletionDeliveryKey(
          completionWake.eventId,
        ),
      now: new Date(requestWake.ask.expiresAt),
      tx: tx as never,
    })).rejects.toMatchObject({
      code: "HOSTED_ASSISTANT_ASK_DELIVERY_AUTHORITY_MISMATCH",
      httpStatus: 403,
      retryable: false,
    });
    expect(mocks.readHostedMailboxWakeByItemId).not.toHaveBeenCalled();
    expect(mocks.readHostedGroupDisclosureGrantAuthorityTx).not.toHaveBeenCalled();
  });

  it("fails closed when the reviewed completion has no paired request", async () => {
    const requestWake = disclosureRequestWake();
    const completionWake = reviewedCompletionWake(requestWake);
    const { tx } = createPrisma();
    mocks.readHostedMailboxItemById.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => input.mailboxItemId === completionWake.eventId
      ? mailboxItemForWake(completionWake)
      : null);
    mocks.readHostedMailboxWakeByItemId.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => input.mailboxItemId === completionWake.eventId ? completionWake : null);

    await expect(assertHostedAssistantAskCompletionDeliveryAuthorityTx({
      answeredMailboxItemIds: [completionWake.eventId],
      boundRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      idempotencyKey:
        createHostedExecutionReviewedAssistantAskCompletionDeliveryKey(
          completionWake.eventId,
        ),
      now: NOW,
      tx: tx as never,
    })).rejects.toMatchObject({
      code: "HOSTED_ASSISTANT_ASK_DELIVERY_AUTHORITY_MISMATCH",
      httpStatus: 403,
      retryable: false,
    });
    expect(mocks.readHostedGroupDisclosureGrantAuthorityTx).not.toHaveBeenCalled();
  });

  it.each(["missing", "extra", "mismatched key"] as const)(
    "rejects a %s reviewed completion mailbox anchor before reading payloads",
    async (variant) => {
    const requestWake = disclosureRequestWake();
    const completionId = createHostedAssistantAskCompletionId(
      requestWake.eventId,
    );
    const { tx } = createPrisma();

    await expect(assertHostedAssistantAskCompletionDeliveryAuthorityTx({
      answeredMailboxItemIds: variant === "missing"
        ? []
        : variant === "extra"
          ? [completionId, "aask_done_unrelated"]
          : [completionId],
      boundRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      idempotencyKey: variant === "mismatched key"
        ? createHostedExecutionReviewedAssistantAskCompletionDeliveryKey(
            "aask_done_unrelated",
          )
        : createHostedExecutionReviewedAssistantAskCompletionDeliveryKey(
            completionId,
          ),
      now: NOW,
      tx: tx as never,
    })).rejects.toMatchObject({
      code: "HOSTED_ASSISTANT_ASK_DELIVERY_AUTHORITY_MISMATCH",
      httpStatus: 403,
      retryable: false,
    });
    expect(mocks.readHostedMailboxItemById).not.toHaveBeenCalled();
    },
  );

  it("leaves legacy Assistant Ask continuation delivery unchanged", async () => {
    const { tx } = createPrisma();

    await expect(assertHostedAssistantAskCompletionDeliveryAuthorityTx({
      answeredMailboxItemIds: [],
      boundRuntimeMemberId: TARGET_MEMBER_ID,
      idempotencyKey: "assistant-ask-completion:legacy",
      now: NOW,
      tx: tx as never,
    })).resolves.toBeUndefined();
    expect(mocks.readHostedMailboxItemById).not.toHaveBeenCalled();
  });

  it("does not reinterpret non-reviewed answered mailbox anchors", async () => {
    const { tx } = createPrisma();

    await expect(assertHostedAssistantAskCompletionDeliveryAuthorityTx({
      answeredMailboxItemIds: ["aask_done_unrelated"],
      boundRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      idempotencyKey: "assistant-outbox:ordinary",
      now: NOW,
      tx: tx as never,
    })).resolves.toBeUndefined();
    expect(mocks.readHostedMailboxItemById).not.toHaveBeenCalled();
  });

  it("does not accept a legacy completion as a replay of reviewed disclosure", async () => {
    const wake = disclosureRequestWake();
    const completionId = createHostedAssistantAskCompletionId(wake.eventId);
    const legacyCompletion = buildHostedExecutionAssistantAskCompletedWake({
      ask: {
        expiresAt: wake.ask.expiresAt,
        originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
        originSessionId: ORIGIN_SESSION_ID,
        question: QUESTION,
        requestId: wake.eventId,
        result: { answer: "Wrong delivery mode.", outcome: "answered" },
        targetLabel: "100 Club",
      },
      eventId: completionId,
      memberId: GROUP_RUNTIME_MEMBER_ID,
      occurredAt: NOW.toISOString(),
    });
    const { prisma } = createPrisma();
    mocks.readHostedMailboxItemById.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => input.mailboxItemId === wake.eventId
      ? mailboxItemForWake(wake)
      : mailboxItemForWake(legacyCompletion));
    mocks.readHostedMailboxWakeByItemId.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => input.mailboxItemId === wake.eventId ? wake : legacyCompletion);

    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: TARGET_MEMBER_ID,
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
});
