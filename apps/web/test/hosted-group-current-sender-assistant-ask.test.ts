import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";
import {
  HOSTED_EXECUTION_CURRENT_SENDER_GROUP_PERMISSION_TEXT,
  HOSTED_EXECUTION_CURRENT_SENDER_PRIVATE_PERMISSION_TEXT,
  isHostedExecutionAssistantAskCompletedWake,
  isHostedExecutionAssistantAskRequestedWake,
  type HostedExecutionWake,
} from "@murphai/hosted-execution/contracts";
import {
  buildHostedExecutionAssistantAskRequestedWake,
  buildHostedExecutionLinqConversationMessageWake,
  createHostedExecutionPrivateAssistantAskCompletionDeliveryKey,
} from "@murphai/hosted-execution";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeWithIdentityTx: vi.fn(),
  assertHostedLinqRouteEgressAuthority: vi.fn(),
  assertHostedThreadRouteEgressAuthority: vi.fn(),
  hostedThreadContainerFindUnique: vi.fn(),
  lookupHostedGroupParticipantMemberByHandle: vi.fn(),
  readHostedGroupDisclosureGrantAuthorityTx: vi.fn(),
  readHostedMailboxConversationWakeByAssistantInputId: vi.fn(),
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

function asPrismaTransactionClient(
  value: typeof fakeTx,
): Prisma.TransactionClient {
  // This unit fixture implements only the transaction methods exercised by the
  // authority owner; the production boundary still requires Prisma's full type.
  // @ts-expect-error -- deliberate narrow test double for this owner boundary.
  return value;
}

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeWithIdentityTx:
    mocks.appendHostedMailboxEnvelopeWithIdentityTx,
  readHostedMailboxConversationWakeByAssistantInputId:
    mocks.readHostedMailboxConversationWakeByAssistantInputId,
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
  createHostedAssistantAskCompletionId,
  handleHostedRuntimeAssistantAskControl,
} from "@/src/lib/hosted-groups/group-assistant-ask";
import {
  assertHostedGroupCurrentSenderPrivateCompletionDeliveryAuthorityTx,
  classifyHostedGroupCurrentSenderRequest,
  createHostedGroupCurrentSenderAssistantAskRequestId,
  createHostedGroupCurrentSenderPrivateDeliveryId,
  createHostedGroupCurrentSenderLegacyAssistantAskRequestId,
  requestHostedGroupCurrentSenderAssistantAsk,
} from "@/src/lib/hosted-groups/group-current-sender-assistant-ask";

const GROUP_RUNTIME_MEMBER_ID = "member_group_runtime";
const OLDER_SENDER_MEMBER_ID = "member_older_sender";
const CURRENT_SENDER_MEMBER_ID = "member_current_sender";
const OLDER_INPUT_ID = `ain_${"a".repeat(32)}`;
const CURRENT_INPUT_ID = `ain_${"b".repeat(32)}`;
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

interface StoredMailboxItem {
  dedupeKey: string;
  expiresAt: string | null;
  id: string;
  kind: string;
  userId: string;
}

const storedItems = new Map<string, StoredMailboxItem>();
const storedWakes = new Map<string, HostedExecutionWake>();
const sourceWakes = new Map<string, ReturnType<typeof createSourceWake>>();
let directRouteAvailable = true;

function createSourceWake(input: {
  from?: string;
  messageId?: string;
  replyToMessageId?: string | null;
  text: string;
}) {
  return buildHostedExecutionLinqConversationMessageWake({
    eventId: `event_${input.messageId ?? "current"}`,
    linqMessage: {
      chatId: "chat_group",
      from: input.from ?? "+15550001002",
      isFromMe: false,
      messageId: input.messageId ?? "message_current",
      parts: [{ type: "text", value: input.text }],
      ...(input.replyToMessageId === undefined
        ? {}
        : { replyToMessageId: input.replyToMessageId }),
      service: "imessage",
      threadIsDirect: false,
    },
    occurredAt: "2026-07-27T19:59:59.000Z",
    phoneLookupKey: "hplk_sender",
    routeAuthority: ROUTE_AUTHORITY,
    userId: GROUP_RUNTIME_MEMBER_ID,
  });
}

function origin(assistantInputId = CURRENT_INPUT_ID) {
  return {
    assistantInputId,
    kind: "accepted_input" as const,
    sessionId: "session_group",
  };
}

async function admit(input: {
  assistantInputId?: string;
  text: string;
}) {
  const assistantInputId = input.assistantInputId ?? CURRENT_INPUT_ID;
  sourceWakes.set(assistantInputId, createSourceWake({ text: input.text }));
  const admission = await requestHostedGroupCurrentSenderAssistantAsk({
    groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
    now: NOW,
    origin: origin(assistantInputId),
  });
  const requestId = createHostedGroupCurrentSenderAssistantAskRequestId({
    groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
    originAssistantInputId: assistantInputId,
  });
  return { admission, requestId };
}

function requireRequestedWake(requestId: string) {
  const wake = storedWakes.get(requestId);
  if (wake === undefined || !isHostedExecutionAssistantAskRequestedWake(wake)) {
    throw new Error("Expected a persisted Assistant Ask request wake.");
  }
  return wake;
}

function requireCompletedWake(completionId: string) {
  const wake = storedWakes.get(completionId);
  if (wake === undefined || !isHostedExecutionAssistantAskCompletedWake(wake)) {
    throw new Error("Expected a persisted Assistant Ask completion wake.");
  }
  return wake;
}

function storeLegacyRequest(input: {
  assistantInputId: string;
  legacyAudience: "group" | "current_sender";
  text: string;
}) {
  sourceWakes.set(input.assistantInputId, createSourceWake({ text: input.text }));
  const requestId = createHostedGroupCurrentSenderLegacyAssistantAskRequestId({
    audience: input.legacyAudience,
    groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
    originAssistantInputId: input.assistantInputId,
  });
  const permissionText = input.legacyAudience === "current_sender"
    ? HOSTED_EXECUTION_CURRENT_SENDER_PRIVATE_PERMISSION_TEXT
    : HOSTED_EXECUTION_CURRENT_SENDER_GROUP_PERMISSION_TEXT;
  const expiresAt = new Date(NOW.getTime() + 10 * 60 * 1_000).toISOString();
  const wake = buildHostedExecutionAssistantAskRequestedWake({
    ask: {
      expiresAt,
      origin: origin(input.assistantInputId),
      question: input.text,
      target: {
        groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
        kind: input.legacyAudience === "current_sender"
          ? "group_sender_private"
          : "group_sender",
        permissionDigest: createHash("sha256").update(permissionText).digest("hex"),
      },
    },
    eventId: requestId,
    memberId: CURRENT_SENDER_MEMBER_ID,
    occurredAt: NOW.toISOString(),
  });
  storedItems.set(requestId, {
    dedupeKey: requestId,
    expiresAt,
    id: requestId,
    kind: wake.kind,
    userId: wake.userId,
  });
  storedWakes.set(requestId, wake);
  return requestId;
}

describe("hosted current-sender Assistant Ask authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storedItems.clear();
    storedWakes.clear();
    sourceWakes.clear();
    directRouteAvailable = true;

    mocks.hostedThreadContainerFindUnique.mockImplementation(
      async ({ where }: { where: { memberId: string } }) =>
        where.memberId === GROUP_RUNTIME_MEMBER_ID
          ? { memberId: GROUP_RUNTIME_MEMBER_ID }
          : null,
    );
    mocks.readHostedMailboxConversationWakeByAssistantInputId.mockImplementation(
      async ({ assistantInputId }: { assistantInputId: string }) =>
        sourceWakes.get(assistantInputId) ?? null,
    );
    mocks.lookupHostedGroupParticipantMemberByHandle.mockImplementation(
      async ({ handle }: { handle: string }) => ({
        core: {
          id: handle === "+15550001001"
            ? OLDER_SENDER_MEMBER_ID
            : CURRENT_SENDER_MEMBER_ID,
        },
      }),
    );
    mocks.resolveHostedMemberRoutingByTelegramUserId.mockResolvedValue({
      lookup: { core: { id: CURRENT_SENDER_MEMBER_ID } },
      status: "found",
    });
    mocks.readHostedMailboxItemById.mockImplementation(
      async ({ mailboxItemId }: { mailboxItemId: string }) =>
        storedItems.get(mailboxItemId) ?? null,
    );
    mocks.readHostedMailboxWakeByItemId.mockImplementation(
      async ({ mailboxItemId }: { mailboxItemId: string }) =>
        storedWakes.get(mailboxItemId) ?? null,
    );
    mocks.readHostedMailboxWakeByDedupeKey.mockImplementation(
      async ({ dedupeKey, userId }: { dedupeKey: string; userId: string }) => {
        const item = storedItems.get(dedupeKey);
        return item?.dedupeKey === dedupeKey && item.userId === userId
          ? storedWakes.get(item.id) ?? null
          : null;
      },
    );
    mocks.requireHostedRuntimeActiveAccess.mockResolvedValue(undefined);
    mocks.requireHostedRuntimeActiveAccessForUpdateTx.mockResolvedValue(undefined);
    mocks.resolveHostedAssistantNotificationDestination.mockImplementation(
      async () => directRouteAvailable
        ? {
            conversationShape: "direct-member",
            externalThreadRouteAuthority: null,
            route: DIRECT_ROUTE,
          }
        : null,
    );
    mocks.assertHostedLinqRouteEgressAuthority.mockResolvedValue(undefined);
    mocks.assertHostedThreadRouteEgressAuthority.mockResolvedValue(undefined);
    mocks.readHostedGroupDisclosureGrantAuthorityTx.mockResolvedValue(null);
    mocks.appendHostedMailboxEnvelopeWithIdentityTx.mockImplementation(
      async (input: {
        envelope: HostedExecutionWake;
        expiresAt?: string | null;
        itemId?: string;
      }) => {
        const itemId = input.itemId ?? input.envelope.eventId;
        const existing = storedItems.get(itemId);
        if (existing) {
          return { dedupeConflict: true, item: existing };
        }
        const item = {
          dedupeKey: itemId,
          expiresAt: input.expiresAt ?? null,
          id: itemId,
          kind: input.envelope.kind,
          userId: input.envelope.userId,
        } satisfies StoredMailboxItem;
        storedItems.set(itemId, item);
        storedWakes.set(itemId, input.envelope);
        return { dedupeConflict: false, item };
      },
    );
  });

  it("admits only the small flat command family and fixes its audience", () => {
    for (const text of [
      "Can you ask my Murph how my synthetic activity has changed?",
      "Murph, ask my Murph how my synthetic activity has changed?",
    ]) {
      expect(classifyHostedGroupCurrentSenderRequest({
        hasNativeReplyContext: false,
        text,
      })).toEqual({ audience: "group" });
    }
    for (const text of [
      "Murph, ask my Murph how my synthetic activity changed and DM me.",
      "Murph, ask my Murph how my synthetic activity changed and send me a direct message.",
      "Murph, ask my Murph what synthetic medications I take and reply in private.",
      "Murph, ask my Murph what synthetic medications I take and send me the answer.",
      "Murph, ask my Murph what synthetic medications I take and text me.",
      "Murph, ask my Murph what synthetic medications I take and answer me.",
      "Murph, ask my Murph how my synthetic activity changed and keep this private.",
      "Murph, ask my Murph how my synthetic activity changed, not for the group.",
      "Murph, ask my Murph how my synthetic activity changed, just between us.",
      "Murph, ask my Murph how my synthetic activity changed, confidentially.",
      "Murph, ask my Murph how my synthetic activity changed, for my eyes only.",
      "Murph, ask my Murph how my synthetic activity changed, keep it between us.",
      "Murph, ask my Murph how my synthetic activity changed, between you and me.",
      "Murph, ask my Murph how my synthetic activity changed, in confidence.",
      "Murph, ask my Murph how my synthetic activity changed, make this private.",
      "Murph, ask my Murph how my synthetic activity changed, for me only.",
      "Murph, ask my Murph how my synthetic activity changed but keep it between us.",
      "Murph, ask my Murph how my synthetic activity changed; please in confidence.",
      "Murph, ask my Murph privately, what synthetic medications do I take?",
      "Murph, ask my Murph confidentially, what synthetic medications do I take?",
      "Murph, ask my Murph in a private message, what synthetic medications do I take?",
      "Murph, ask my Murph for my eyes only, what synthetic medications do I take?",
      "Murph, ask my Murph privately what synthetic medications do I take?",
      "Murph, ask my Murph what synthetic medications do I take, one-on-one.",
      "Murph, ask my Murph what synthetic medications do I take, one to one.",
      "Murph, ask my Murph one-on-one what synthetic medications do I take?",
      "Murph, ask my Murph what synthetic medications do I take, reply one-on-one.",
      "Murph, ask my Murph what synthetic medications do I take, send it to my DMs.",
      "Murph, ask my Murph what synthetic medications do I take, send the answer to my DM.",
    ]) {
      expect(classifyHostedGroupCurrentSenderRequest({
        hasNativeReplyContext: false,
        text,
      }), text).toEqual({ audience: "current_sender" });
    }

    expect(classifyHostedGroupCurrentSenderRequest({
      hasNativeReplyContext: false,
      text: "Murph, ask my Murph what private insurance coverage I have?",
    })).toEqual({ audience: "group" });

    for (const text of [
      "Murph, ask my Murph what synthetic medications I take and let me know privately.",
      "Murph, ask my Murph what synthetic medications I take and deliver the answer to the chat owner.",
      "Murph, ask my Murph what synthetic medications I take, off the record.",
      "Murph, ask my Murph what synthetic medications I take, don't make it public.",
      "Murph, ask my Murph what synthetic medications I take, this is a secret.",
      "Murph, ask my Murph what synthetic medications I take, answer by carrier pigeon.",
      "Murph, ask my Murph answer by carrier pigeon, what synthetic medications I take?",
      "Murph, ask my Murph what synthetic medications I take and the answer should stay private.",
      "Murph, ask my Murph what synthetic medications I take and I want the answer to stay private.",
      "Murph, ask my Murph what synthetic medications I take and the group shouldn't see the answer.",
      "Murph, ask my Murph to DM me my synthetic recovery score.",
      "Murph, ask my Murph to message me what synthetic medications I take.",
      "Murph, ask my Murph can you DM me my synthetic recovery score?",
      "Murph, ask my Murph what my synthetic recovery score is privately.",
      "Murph, ask my Murph what my synthetic recovery score is just for me.",
    ]) {
      expect(classifyHostedGroupCurrentSenderRequest({
        hasNativeReplyContext: false,
        text,
      })).toHaveProperty("unavailableReason");
    }

    for (const input of [
      {
        hasNativeReplyContext: true,
        text: "Murph, ask my Murph about my synthetic activity.",
      },
      {
        hasNativeReplyContext: false,
        text: "Murph, ask my Murph about the previous reply.",
      },
      {
        hasNativeReplyContext: false,
        text: "Murph, ask my Murph based on this discussion.",
      },
      {
        hasNativeReplyContext: false,
        text: "Murph, ask my Murph not to answer this.",
      },
      {
        hasNativeReplyContext: false,
        text: "Murph, ask my Murph how my synthetic activity changed, but don't post it.",
      },
      {
        hasNativeReplyContext: false,
        text: "Murph, ask my Murph \"what the other person said\".",
      },
      {
        hasNativeReplyContext: false,
        text: "Murph, ask someone about my synthetic activity.",
      },
      {
        hasNativeReplyContext: false,
        text: "Murph, ask my Murph and reply in the group and DM me.",
      },
      {
        hasNativeReplyContext: false,
        text: "Murph, ask my Murph privately, what changed, then tell the group.",
      },
    ]) {
      expect(classifyHostedGroupCurrentSenderRequest(input)).toHaveProperty(
        "unavailableReason",
      );
    }
  });

  it("rejects conflicting audience wording before enqueue or route resolution", async () => {
    const { admission } = await admit({
      text: "Murph, ask my Murph how my synthetic activity changed, tell the group, and DM me.",
    });
    expect(admission).toMatchObject({
      mailboxWake: null,
      result: {
        status: "unavailable",
        unavailableReason: expect.stringMatching(/choose either the group or a private reply/u),
      },
    });
    expect(storedItems.size).toBe(0);
    expect(
      mocks.resolveHostedAssistantNotificationDestination,
    ).not.toHaveBeenCalled();
  });

  it.each([
    "Murph, ask my Murph what synthetic medications I take and the answer should stay private.",
    "Murph, ask my Murph what synthetic medications I take and I want the answer to stay private.",
    "Murph, ask my Murph what synthetic medications I take and the group shouldn't see the answer.",
  ])("rejects a subject-led private clause before enqueue: %s", async (text) => {
    const { admission } = await admit({ text });

    expect(admission).toMatchObject({
      mailboxWake: null,
      result: {
        status: "unavailable",
        unavailableReason: expect.stringMatching(/choose either the group or a private reply/u),
      },
    });
    expect(storedItems.size).toBe(0);
    expect(storedWakes.size).toBe(0);
    expect(
      mocks.resolveHostedAssistantNotificationDestination,
    ).not.toHaveBeenCalled();
  });

  it.each([
    "Murph, ask my Murph to DM me my synthetic recovery score.",
    "Murph, ask my Murph to message me what synthetic medications I take.",
    "Murph, ask my Murph can you DM me my synthetic recovery score?",
    "Murph, ask my Murph what my synthetic recovery score is privately.",
    "Murph, ask my Murph what my synthetic recovery score is just for me.",
  ])("rejects an unconsumed private directive before enqueue: %s", async (text) => {
    const { admission } = await admit({ text });

    expect(admission).toMatchObject({
      mailboxWake: null,
      result: {
        status: "unavailable",
        unavailableReason: expect.stringMatching(/choose either the group or a private reply/u),
      },
    });
    expect(storedItems.size).toBe(0);
    expect(storedWakes.size).toBe(0);
    expect(
      mocks.resolveHostedAssistantNotificationDestination,
    ).not.toHaveBeenCalled();
  });

  it("binds a mixed-sender batch to the later exact author, never an older native reply", async () => {
    sourceWakes.set(OLDER_INPUT_ID, createSourceWake({
      from: "+15550001001",
      messageId: "message_older",
      replyToMessageId: "message_human",
      text: "Synthetic conversational reply.",
    }));
    sourceWakes.set(CURRENT_INPUT_ID, createSourceWake({
      from: "+15550001002",
      messageId: "message_current",
      text: "Murph, ask my Murph how my synthetic activity has changed?",
    }));

    await expect(requestHostedGroupCurrentSenderAssistantAsk({
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      now: NOW,
      origin: origin(CURRENT_INPUT_ID),
    })).resolves.toMatchObject({
      mailboxWake: { expectedUserId: CURRENT_SENDER_MEMBER_ID },
      result: { status: "accepted" },
    });
    expect(
      mocks.readHostedMailboxConversationWakeByAssistantInputId,
    ).toHaveBeenCalledWith({
      assistantInputId: CURRENT_INPUT_ID,
      availableAt: NOW,
      memberId: GROUP_RUNTIME_MEMBER_ID,
      prisma: fakeTx,
    });
    expect(
      mocks.readHostedMailboxConversationWakeByAssistantInputId,
    ).not.toHaveBeenCalledWith(expect.objectContaining({
      assistantInputId: OLDER_INPUT_ID,
    }));

    storedItems.clear();
    storedWakes.clear();
    await expect(requestHostedGroupCurrentSenderAssistantAsk({
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      now: NOW,
      origin: origin(OLDER_INPUT_ID),
    })).resolves.toMatchObject({
      mailboxWake: null,
      result: { status: "unavailable" },
    });
  });

  it("admits two independent flat requests from one mixed-sender batch", async () => {
    sourceWakes.set(OLDER_INPUT_ID, createSourceWake({
      from: "+15550001001",
      messageId: "message_older",
      text: "Murph, ask my Murph how my synthetic sleep has changed?",
    }));
    sourceWakes.set(CURRENT_INPUT_ID, createSourceWake({
      from: "+15550001002",
      messageId: "message_current",
      text: "Murph, ask my Murph how my synthetic activity has changed?",
    }));

    const olderRequestId = createHostedGroupCurrentSenderAssistantAskRequestId({
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      originAssistantInputId: OLDER_INPUT_ID,
    });
    const currentRequestId = createHostedGroupCurrentSenderAssistantAskRequestId({
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      originAssistantInputId: CURRENT_INPUT_ID,
    });
    const [olderAdmission, currentAdmission] = await Promise.all([
      requestHostedGroupCurrentSenderAssistantAsk({
        groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
        now: NOW,
        origin: origin(OLDER_INPUT_ID),
      }),
      requestHostedGroupCurrentSenderAssistantAsk({
        groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
        now: NOW,
        origin: origin(CURRENT_INPUT_ID),
      }),
    ]);

    expect(olderAdmission).toMatchObject({
      mailboxWake: {
        expectedUserId: OLDER_SENDER_MEMBER_ID,
        mailboxItemId: olderRequestId,
      },
      result: { status: "accepted" },
    });
    expect(currentAdmission).toMatchObject({
      mailboxWake: {
        expectedUserId: CURRENT_SENDER_MEMBER_ID,
        mailboxItemId: currentRequestId,
      },
      result: { status: "accepted" },
    });
    expect(requireRequestedWake(olderRequestId).userId)
      .toBe(OLDER_SENDER_MEMBER_ID);
    expect(requireRequestedWake(currentRequestId).userId)
      .toBe(CURRENT_SENDER_MEMBER_ID);
  });

  it("persists one fixed group target and replays one origin", async () => {
    const { admission, requestId } = await admit({
      text: "Can you ask my Murph how my synthetic activity has changed?",
    });
    expect(admission).toEqual({
      mailboxWake: {
        expectedUserId: CURRENT_SENDER_MEMBER_ID,
        mailboxItemId: requestId,
      },
      result: { status: "accepted" },
    });
    const wake = requireRequestedWake(requestId);
    expect(wake.ask).toMatchObject({
      origin: origin(),
      question: "Can you ask my Murph how my synthetic activity has changed?",
      target: {
        groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
        kind: "group_sender",
        permissionDigest: createHash("sha256")
          .update(HOSTED_EXECUTION_CURRENT_SENDER_GROUP_PERMISSION_TEXT)
          .digest("hex"),
      },
    });

    await expect(requestHostedGroupCurrentSenderAssistantAsk({
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      now: NOW,
      origin: origin(),
    })).resolves.toEqual(admission);
    expect(storedItems.size).toBe(1);
  });

  it("drains legacy fixed targets only when exact-source classification agrees", async () => {
    const legacyGroupId = storeLegacyRequest({
      assistantInputId: CURRENT_INPUT_ID,
      legacyAudience: "group",
      text: "Murph, ask my Murph about my synthetic activity and DM me.",
    });
    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: CURRENT_SENDER_MEMBER_ID,
      now: NOW,
      request: { action: "prepare", requestId: legacyGroupId },
    })).resolves.toMatchObject({
      mailboxWake: {
        expectedUserId: GROUP_RUNTIME_MEMBER_ID,
        mailboxItemId: createHostedAssistantAskCompletionId(legacyGroupId),
      },
      response: { action: "prepare", status: "already_completed" },
    });
    expect(requireCompletedWake(
      createHostedAssistantAskCompletionId(legacyGroupId),
    ).ask.result).toEqual({ answer: null, outcome: "cannot_answer" });

    storedItems.clear();
    storedWakes.clear();
    sourceWakes.clear();
    const legacyPrivateId = storeLegacyRequest({
      assistantInputId: OLDER_INPUT_ID,
      legacyAudience: "current_sender",
      text: "Murph, ask my Murph about my synthetic activity in the group.",
    });
    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: CURRENT_SENDER_MEMBER_ID,
      now: NOW,
      request: { action: "prepare", requestId: legacyPrivateId },
    })).resolves.toMatchObject({
      mailboxWake: {
        expectedUserId: GROUP_RUNTIME_MEMBER_ID,
        mailboxItemId: createHostedAssistantAskCompletionId(legacyPrivateId),
      },
      response: { action: "prepare", status: "already_completed" },
    });
    expect(requireCompletedWake(
      createHostedAssistantAskCompletionId(legacyPrivateId),
    ).ask.result).toEqual({ answer: null, outcome: "cannot_answer" });
  });

  it("fixes private audience only after resolving a same-channel direct route", async () => {
    const { admission, requestId } = await admit({
      text: "Murph, ask my Murph one-on-one how my synthetic activity changed?",
    });
    expect(admission.result).toEqual({ status: "accepted" });
    expect(requireRequestedWake(requestId).ask.target).toEqual({
      groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      kind: "group_sender_private",
      permissionDigest: createHash("sha256")
        .update(HOSTED_EXECUTION_CURRENT_SENDER_PRIVATE_PERMISSION_TEXT)
        .digest("hex"),
    });

    storedItems.clear();
    storedWakes.clear();
    directRouteAvailable = false;
    const unavailable = await admit({
      text: "Murph, ask my Murph send the answer to my DMs, how did my synthetic activity change?",
    });
    expect(unavailable.admission).toMatchObject({
      mailboxWake: null,
      result: {
        status: "unavailable",
        unavailableReason: expect.stringMatching(/open a direct chat/u),
      },
    });
    expect(storedItems.size).toBe(0);
  });

  it("persists a group terminal when accepted source evidence is unavailable after restart", async () => {
    const { requestId } = await admit({
      text: "Murph, ask my Murph how my synthetic activity changed and DM me.",
    });
    sourceWakes.delete(CURRENT_INPUT_ID);
    const completionId = createHostedAssistantAskCompletionId(requestId);

    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: CURRENT_SENDER_MEMBER_ID,
      now: NOW,
      request: { action: "prepare", requestId },
    })).resolves.toEqual({
      mailboxWake: {
        expectedUserId: GROUP_RUNTIME_MEMBER_ID,
        mailboxItemId: completionId,
      },
      response: { action: "prepare", status: "already_completed" },
    });
    expect(requireCompletedWake(completionId)).toMatchObject({
      ask: {
        requestId,
        result: { answer: null, outcome: "cannot_answer" },
      },
      userId: GROUP_RUNTIME_MEMBER_ID,
    });
  });

  it("persists a group terminal before personal work when the admitted private route is lost", async () => {
    const { requestId } = await admit({
      text: "Murph, ask my Murph how my synthetic activity changed and DM me.",
    });
    directRouteAvailable = false;
    const completionId = createHostedAssistantAskCompletionId(requestId);

    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: CURRENT_SENDER_MEMBER_ID,
      now: NOW,
      request: { action: "prepare", requestId },
    })).resolves.toEqual({
      mailboxWake: {
        expectedUserId: GROUP_RUNTIME_MEMBER_ID,
        mailboxItemId: completionId,
      },
      response: { action: "prepare", status: "already_completed" },
    });
    expect(requireCompletedWake(completionId)).toMatchObject({
      ask: {
        requestId,
        result: { answer: null, outcome: "cannot_answer" },
      },
      userId: GROUP_RUNTIME_MEMBER_ID,
    });
  });

  it("completes a fixed group request only through the originating group", async () => {
    const { requestId } = await admit({
      text: "Murph, ask my Murph how my synthetic activity has changed?",
    });
    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: CURRENT_SENDER_MEMBER_ID,
      now: NOW,
      request: { action: "prepare", requestId },
    })).resolves.toMatchObject({
      response: {
        action: "prepare",
        disclosure: {
          permissionText: HOSTED_EXECUTION_CURRENT_SENDER_GROUP_PERMISSION_TEXT,
        },
        status: "ready",
      },
    });

    const result = {
      answer: "Synthetic activity increased.",
      outcome: "answered" as const,
    };
    const completed = await handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: CURRENT_SENDER_MEMBER_ID,
      now: NOW,
      request: { action: "complete", requestId, result },
    });
    const completionId = createHostedAssistantAskCompletionId(requestId);
    expect(completed).toEqual({
      mailboxWake: {
        expectedUserId: GROUP_RUNTIME_MEMBER_ID,
        mailboxItemId: completionId,
      },
      response: { action: "complete", status: "completed" },
    });
    expect(requireCompletedWake(completionId)).toMatchObject({
      ask: { requestId, result },
      userId: GROUP_RUNTIME_MEMBER_ID,
    });

    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: CURRENT_SENDER_MEMBER_ID,
      now: NOW,
      request: { action: "complete", requestId, result },
    })).resolves.toMatchObject({
      response: { action: "complete", status: "already_completed" },
    });
    expect(storedItems.size).toBe(2);
  });

  it.each([
    {
      label: "answered",
      result: { answer: "Synthetic late answer.", outcome: "answered" as const },
    },
    {
      label: "cannot-answer",
      result: { answer: null, outcome: "cannot_answer" as const },
    },
  ])("keeps a late $label group terminal visible for one fresh window", async ({ result }) => {
    const { requestId } = await admit({
      text: "Murph, ask my Murph how my synthetic activity has changed?",
    });
    const requestWake = requireRequestedWake(requestId);
    const requestExpiresAtMs = Date.parse(requestWake.ask.expiresAt);
    const completedAt = new Date(requestExpiresAtMs - 1);
    const completionId = createHostedAssistantAskCompletionId(requestId);

    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: CURRENT_SENDER_MEMBER_ID,
      now: completedAt,
      request: { action: "complete", requestId, result },
    })).resolves.toMatchObject({
      mailboxWake: { mailboxItemId: completionId },
      response: { status: "completed" },
    });

    const completionWake = requireCompletedWake(completionId);
    expect(Date.parse(completionWake.ask.expiresAt)).toBe(
      completedAt.getTime() + 10 * 60 * 1_000,
    );
    expect(storedItems.get(completionId)?.expiresAt).toBe(
      completionWake.ask.expiresAt,
    );
    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: CURRENT_SENDER_MEMBER_ID,
      now: new Date(requestExpiresAtMs + 1),
      request: { action: "prepare", requestId },
    })).resolves.toMatchObject({
      mailboxWake: { mailboxItemId: completionId },
      response: { status: "already_completed" },
    });
  });

  it("delivers a fixed private answer as exact text on the admitted channel", async () => {
    const { requestId } = await admit({
      text: "Murph, ask my Murph how my synthetic activity changed and DM me.",
    });
    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: CURRENT_SENDER_MEMBER_ID,
      now: NOW,
      request: { action: "prepare", requestId },
    })).resolves.toMatchObject({
      response: {
        disclosure: {
          permissionText: HOSTED_EXECUTION_CURRENT_SENDER_PRIVATE_PERMISSION_TEXT,
        },
        status: "ready",
      },
    });

    const result = {
      answer: "Synthetic private activity answer.",
      outcome: "answered" as const,
    };
    const completionId = createHostedAssistantAskCompletionId(requestId);
    const privateDeliveryId =
      createHostedGroupCurrentSenderPrivateDeliveryId(requestId);
    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: CURRENT_SENDER_MEMBER_ID,
      now: NOW,
      request: { action: "complete", requestId, result },
    })).resolves.toEqual({
      mailboxWake: {
        expectedUserId: CURRENT_SENDER_MEMBER_ID,
        mailboxItemId: privateDeliveryId,
      },
      response: { action: "complete", status: "completed" },
    });
    expect(storedWakes.get(privateDeliveryId)).toMatchObject({
      kind: "assistant.notification.requested",
      notification: {
        responsePolicy: {
          kind: "require_send_exact_text",
          text: result.answer,
        },
        route: DIRECT_ROUTE,
      },
      userId: CURRENT_SENDER_MEMBER_ID,
    });
    expect(JSON.stringify(storedWakes.get(privateDeliveryId))).not.toContain(
      GROUP_RUNTIME_MEMBER_ID,
    );
    expect(storedWakes.has(completionId)).toBe(false);
  });

  it("falls back once to a non-disclosing group terminal when the private route is lost", async () => {
    const { requestId } = await admit({
      text: "Murph, ask my Murph how my synthetic activity changed and DM me.",
    });
    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: CURRENT_SENDER_MEMBER_ID,
      now: NOW,
      request: { action: "prepare", requestId },
    })).resolves.toMatchObject({ response: { status: "ready" } });

    directRouteAvailable = false;
    const completionId = createHostedAssistantAskCompletionId(requestId);
    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: CURRENT_SENDER_MEMBER_ID,
      now: NOW,
      request: {
        action: "complete",
        requestId,
        result: {
          answer: "This private answer must never reach the group.",
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
    const fallback = requireCompletedWake(completionId);
    expect(fallback).toMatchObject({
      ask: {
        requestId,
        result: { answer: null, outcome: "cannot_answer" },
      },
      userId: GROUP_RUNTIME_MEMBER_ID,
    });
    expect(JSON.stringify(fallback)).not.toContain(
      "This private answer must never reach the group.",
    );

    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: CURRENT_SENDER_MEMBER_ID,
      now: NOW,
      request: { action: "prepare", requestId },
    })).resolves.toMatchObject({
      response: { action: "prepare", status: "already_completed" },
    });
    expect(storedItems.size).toBe(2);
  });

  it("persists a fresh group terminal when the request expires before prepare", async () => {
    const { requestId } = await admit({
      text: "Murph, ask my Murph how my synthetic activity has changed?",
    });
    const expiredAt = new Date(NOW.getTime() + 10 * 60 * 1_000);
    const completionId = createHostedAssistantAskCompletionId(requestId);

    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: CURRENT_SENDER_MEMBER_ID,
      now: expiredAt,
      request: { action: "prepare", requestId },
    })).resolves.toEqual({
      mailboxWake: {
        expectedUserId: GROUP_RUNTIME_MEMBER_ID,
        mailboxItemId: completionId,
      },
      response: { action: "prepare", status: "already_completed" },
    });
    const fallback = requireCompletedWake(completionId);
    expect(fallback).toMatchObject({
      ask: {
        requestId,
        result: { answer: null, outcome: "cannot_answer" },
      },
      userId: GROUP_RUNTIME_MEMBER_ID,
    });
    expect(Date.parse(fallback.ask.expiresAt)).toBe(
      expiredAt.getTime() + 10 * 60 * 1_000,
    );
  });

  it.each([
    {
      label: "answered",
      result: { answer: "Synthetic group answer.", outcome: "answered" as const },
    },
    {
      label: "cannot-answer",
      result: { answer: null, outcome: "cannot_answer" as const },
    },
  ])("replays an expired $label group terminal after a lost completion response", async ({ result }) => {
    const { requestId } = await admit({
      text: "Murph, ask my Murph how my synthetic activity has changed?",
    });
    const completionId = createHostedAssistantAskCompletionId(requestId);
    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: CURRENT_SENDER_MEMBER_ID,
      now: NOW,
      request: {
        action: "complete",
        requestId,
        result,
      },
    })).resolves.toMatchObject({
      response: { action: "complete", status: "completed" },
    });

    await expect(handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: CURRENT_SENDER_MEMBER_ID,
      now: new Date(NOW.getTime() + 10 * 60 * 1_000),
      request: { action: "prepare", requestId },
    })).resolves.toEqual({
      mailboxWake: {
        expectedUserId: GROUP_RUNTIME_MEMBER_ID,
        mailboxItemId: completionId,
      },
      response: { action: "prepare", status: "already_completed" },
    });
    expect(storedItems.size).toBe(2);
    expect(requireCompletedWake(completionId).ask.result).toEqual(result);
  });

  it("persists the group terminal when private delivery authority is lost", async () => {
    const { requestId } = await admit({
      text: "Murph, ask my Murph how my synthetic activity changed and DM me.",
    });
    const answer = "Synthetic private answer that must stay private.";
    await handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: CURRENT_SENDER_MEMBER_ID,
      now: NOW,
      request: {
        action: "complete",
        requestId,
        result: { answer, outcome: "answered" },
      },
    });
    const privateDeliveryId =
      createHostedGroupCurrentSenderPrivateDeliveryId(requestId);
    const requestWake = requireRequestedWake(requestId);
    directRouteAvailable = false;

    await expect(
      assertHostedGroupCurrentSenderPrivateCompletionDeliveryAuthorityTx({
        answeredMailboxItemIds: [privateDeliveryId],
        assistantAskCompletionExpiresAt: requestWake.ask.expiresAt,
        boundRuntimeMemberId: CURRENT_SENDER_MEMBER_ID,
        idempotencyKey:
          createHostedExecutionPrivateAssistantAskCompletionDeliveryKey(
            privateDeliveryId,
          ),
        now: new Date(NOW.getTime() + 1_000),
        responseTextDigest: createHash("sha256").update(answer).digest("hex"),
        route: DIRECT_ROUTE,
        tx: asPrismaTransactionClient(fakeTx),
      }),
    ).resolves.toEqual({
      assistantAskFallbackRequired: true,
      mailboxWake: {
        expectedUserId: GROUP_RUNTIME_MEMBER_ID,
        mailboxItemId: createHostedAssistantAskCompletionId(requestId),
      },
    });
    const fallback = requireCompletedWake(
      createHostedAssistantAskCompletionId(requestId),
    );
    expect(fallback.ask.result).toEqual({
      answer: null,
      outcome: "cannot_answer",
    });
    expect(JSON.stringify(fallback)).not.toContain(answer);
  });

  it("persists a fresh group terminal when private delivery reaches provider entry after expiry", async () => {
    const { requestId } = await admit({
      text: "Murph, ask my Murph how my synthetic activity changed and DM me.",
    });
    const answer = "Synthetic expired private answer that must stay private.";
    const requestWake = requireRequestedWake(requestId);
    const completedAt = new Date(Date.parse(requestWake.ask.expiresAt) - 1);
    await handleHostedRuntimeAssistantAskControl({
      boundRuntimeMemberId: CURRENT_SENDER_MEMBER_ID,
      now: completedAt,
      request: {
        action: "complete",
        requestId,
        result: { answer, outcome: "answered" },
      },
    });
    const privateDeliveryId =
      createHostedGroupCurrentSenderPrivateDeliveryId(requestId);
    const privateDeliveryWake = storedWakes.get(privateDeliveryId);
    expect(privateDeliveryWake).toMatchObject({
      notification: {
        privateAssistantAskCompletion: {
          expiresAt: requestWake.ask.expiresAt,
          requestId,
        },
      },
    });
    expect(Date.parse(storedItems.get(privateDeliveryId)?.expiresAt ?? "")).toBe(
      completedAt.getTime() + 10 * 60 * 1_000,
    );
    const providerEntryAt = new Date(Date.parse(requestWake.ask.expiresAt) + 1);

    await expect(
      assertHostedGroupCurrentSenderPrivateCompletionDeliveryAuthorityTx({
        answeredMailboxItemIds: [privateDeliveryId],
        assistantAskCompletionExpiresAt: requestWake.ask.expiresAt,
        boundRuntimeMemberId: CURRENT_SENDER_MEMBER_ID,
        idempotencyKey:
          createHostedExecutionPrivateAssistantAskCompletionDeliveryKey(
            privateDeliveryId,
          ),
        now: providerEntryAt,
        responseTextDigest: createHash("sha256").update(answer).digest("hex"),
        route: DIRECT_ROUTE,
        tx: asPrismaTransactionClient(fakeTx),
      }),
    ).resolves.toEqual({
      assistantAskFallbackRequired: true,
      mailboxWake: {
        expectedUserId: GROUP_RUNTIME_MEMBER_ID,
        mailboxItemId: createHostedAssistantAskCompletionId(requestId),
      },
    });
    const fallback = requireCompletedWake(
      createHostedAssistantAskCompletionId(requestId),
    );
    expect(fallback.ask.result).toEqual({
      answer: null,
      outcome: "cannot_answer",
    });
    expect(Date.parse(fallback.ask.expiresAt)).toBe(
      providerEntryAt.getTime() + 10 * 60 * 1_000,
    );
    expect(JSON.stringify(fallback)).not.toContain(answer);
  });
});
