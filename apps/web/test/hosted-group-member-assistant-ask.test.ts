import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeWithIdentityTx: vi.fn(),
  assertHostedLinqRouteEgressAuthority: vi.fn(),
  readHostedGroupDisclosureGrantAuthorityTx: vi.fn(),
  readHostedMailboxConversationWakeByAssistantInputId: vi.fn(),
  readHostedMailboxItemById: vi.fn(),
  readHostedMailboxWakeByItemId: vi.fn(),
  requireHostedRuntimeActiveAccess: vi.fn(),
  requireHostedRuntimeActiveAccessForUpdateTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeWithIdentityTx:
    mocks.appendHostedMailboxEnvelopeWithIdentityTx,
  readHostedMailboxConversationWakeByAssistantInputId:
    mocks.readHostedMailboxConversationWakeByAssistantInputId,
  readHostedMailboxItemById: mocks.readHostedMailboxItemById,
  readHostedMailboxWakeByItemId: mocks.readHostedMailboxWakeByItemId,
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
}));

import {
  createHostedAssistantAskCompletionId,
  createHostedGroupMemberAssistantAskRequestId,
  handleHostedRuntimeAssistantAskControl,
  isHostedGroupDisclosureProducerEnabled,
  requestHostedGroupMemberAssistantAsk,
} from "@/src/lib/hosted-groups/group-assistant-ask";
import {
  buildHostedExecutionAssistantAskCompletedWake,
  buildHostedExecutionAssistantAskRequestedWake,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
} from "@murphai/hosted-execution/contracts";

const NOW = new Date("2026-07-16T12:00:00.000Z");
const GROUP_RUNTIME_MEMBER_ID = "member-group-runtime";
const TARGET_MEMBER_ID = "member-personal";
const ORIGIN_ASSISTANT_INPUT_ID = `ain_${"b".repeat(32)}`;
const ORIGIN_SESSION_ID = "session_group";
const GRANT_ID = "hgrpdg_current";
const MEMBERSHIP_ID = "hgrpm_current";
const PERMISSION_DIGEST = "d".repeat(64);
const PERMISSION_TEXT =
  "Share my calendar availability only for coordinating a call with this group.";
const QUESTION = "Which times work for a call tomorrow?";
const ENABLED_ENVIRONMENT = {
  HOSTED_GROUP_DISCLOSURE_PRODUCER_ENABLED: "1",
} as const;

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
    groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
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
    $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]),
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
    environment: ENABLED_ENVIRONMENT,
    grantId: GRANT_ID,
    memberId: GROUP_RUNTIME_MEMBER_ID,
    now: NOW,
    originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
    originSessionId: ORIGIN_SESSION_ID,
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

  it("uses a separate exact-one producer gate", async () => {
    const { prisma } = createPrisma();

    expect(isHostedGroupDisclosureProducerEnabled({
      HOSTED_GROUP_DISCLOSURE_PRODUCER_ENABLED: "true",
    })).toBe(false);
    await expect(requestDisclosure(prisma, {
      environment: { HOSTED_ASSISTANT_ASK_PRODUCER_ENABLED: "1" },
    })).resolves.toEqual({
      mailboxWake: null,
      result: { status: "unavailable", unavailableReason: "feature_disabled" },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("pins the exact current grant generation before waking the personal runtime", async () => {
    const { prisma } = createPrisma();
    const requestId = createHostedGroupMemberAssistantAskRequestId({
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
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

  it("admits at most one grant from the same group input under concurrent calls", async () => {
    const secondGrantId = "hgrpdg_second";
    const { prisma, tx } = createPrisma();
    let storedWake: ReturnType<typeof disclosureRequestWake> | null = null;
    mocks.readHostedMailboxItemById.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => storedWake?.eventId === input.mailboxItemId
      ? mailboxItemForWake(storedWake)
      : null);
    mocks.readHostedMailboxWakeByItemId.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => storedWake?.eventId === input.mailboxItemId ? storedWake : null);
    mocks.appendHostedMailboxEnvelopeWithIdentityTx.mockImplementation(
      async (input: { envelope: ReturnType<typeof disclosureRequestWake> }) => {
        storedWake = input.envelope;
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

    const requestId = createHostedGroupMemberAssistantAskRequestId({
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
    });
    const request = (grantId: string) => requestDisclosure(prisma, { grantId });

    await expect(Promise.all([request(GRANT_ID), request(secondGrantId)]))
      .resolves.toEqual([
        {
          mailboxWake: {
            expectedUserId: TARGET_MEMBER_ID,
            mailboxItemId: requestId,
          },
          result: { status: "accepted" },
        },
        {
          mailboxWake: null,
          result: { status: "unavailable", unavailableReason: "request_conflict" },
        },
      ]);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw.mock.calls.map((call) => call[2])).toEqual([
      requestId,
      requestId,
    ]);
    for (const callIndex of [0, 1]) {
      expect(tx.$queryRaw.mock.invocationCallOrder[callIndex]).toBeLessThan(
        mocks.readHostedMailboxItemById.mock.invocationCallOrder[callIndex] ?? 0,
      );
    }
    expect(mocks.appendHostedMailboxEnvelopeWithIdentityTx).toHaveBeenCalledTimes(1);
  });

  it("allows another grant only from a fresh accepted group input", async () => {
    const freshOriginAssistantInputId = `ain_${"c".repeat(32)}`;
    const secondGrantId = "hgrpdg_second";
    const secondTargetMemberId = "member-personal-second";
    const { prisma } = createPrisma();
    mocks.readHostedGroupDisclosureGrantAuthorityTx.mockResolvedValue({
      ...disclosureAuthority(),
      grantId: secondGrantId,
      membershipId: "hgrpm_second",
      permissionDigest: "e".repeat(64),
      targetMemberId: secondTargetMemberId,
    });
    const requestId = createHostedGroupMemberAssistantAskRequestId({
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      originAssistantInputId: freshOriginAssistantInputId,
    });

    await expect(requestDisclosure(prisma, {
      grantId: secondGrantId,
      originAssistantInputId: freshOriginAssistantInputId,
    })).resolves.toEqual({
      mailboxWake: {
        expectedUserId: secondTargetMemberId,
        mailboxItemId: requestId,
      },
      result: { status: "accepted" },
    });
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
      { grantId: "hgrpdg_different" },
      { originSessionId: "session_different" },
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
          deliveryMode: "reviewed_exact",
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
