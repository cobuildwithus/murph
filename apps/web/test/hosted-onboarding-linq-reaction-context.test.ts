import type { Prisma, PrismaClient } from "@prisma/client";
import {
  parseHostedExecutionGroupReactionEventText,
  readHostedExecutionConversationMessageText,
} from "@murphai/hosted-execution";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getHostedDomainRootUnwrapCache,
} from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";

interface TestRootResult {
  envelope: { rootKeyId: string };
  rootKey: Uint8Array;
}

const state = vi.hoisted(() => ({
  activeRootKeyIds: [] as Array<string | null>,
  calls: [] as string[],
  preparedRootKeyIds: [] as string[],
  preparationError: null as Error | null,
  providerResultsByScope:
    new WeakMap<object, Map<string, Promise<TestRootResult>>>(),
  routeResults: [] as unknown[],
  transactionDepth: 0,
}));

const mocks = vi.hoisted(() => ({
  acquireHostedLinqChatOwnershipLockTx: vi.fn(),
  appendConsumedHostedGroupReactionMailboxEnvelopeTx: vi.fn(),
  getHostedLinqChatSummary: vi.fn(),
  lockAndReadActiveHostedDomainRootKeyIdTx: vi.fn(),
  lockHostedThreadRouteByThreadIdentityTx: vi.fn(),
  providerKmsWork: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  readHostedThreadRouteByThreadIdentity: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
  unwrapHostedDomainRootForWeb: vi.fn(),
}));

vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  lockHostedThreadRouteByThreadIdentityTx:
    mocks.lockHostedThreadRouteByThreadIdentityTx,
  readHostedThreadRouteByThreadIdentity:
    mocks.readHostedThreadRouteByThreadIdentity,
}));

vi.mock("@/src/lib/hosted-routing/linq-chat-ownership-lock", () => ({
  acquireHostedLinqChatOwnershipLockTx:
    mocks.acquireHostedLinqChatOwnershipLockTx,
}));

vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({
  lockAndReadActiveHostedDomainRootKeyIdTx:
    mocks.lockAndReadActiveHostedDomainRootKeyIdTx,
  unwrapHostedDomainRootForWeb: mocks.unwrapHostedDomainRootForWeb,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-client", () => ({
  getHostedLinqChatSummary: mocks.getHostedLinqChatSummary,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
}));

vi.mock("@/src/lib/hosted-onboarding/group-reaction-mailbox", () => ({
  appendConsumedHostedGroupReactionMailboxEnvelopeTx:
    mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx,
}));

import type { HostedLinqWebhookEvent } from "@/src/lib/hosted-onboarding/linq";
import { parseHostedLinqProviderEvent } from "@/src/lib/hosted-onboarding/linq-provider-events";
import {
  appendHostedLinqGroupReactionMailboxTx,
  buildHostedLinqAffirmativeReactionMessageEvent,
  stageHostedLinqGroupReactionContext,
} from "@/src/lib/hosted-onboarding/webhook-provider-linq-reaction-context";

const TEST_CONTACT_PRIVACY_KEY =
  "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=";

beforeEach(() => {
  vi.resetAllMocks();
  configureHostedContactPrivacyKeyringForTest();
  state.activeRootKeyIds.length = 0;
  state.calls.length = 0;
  state.preparedRootKeyIds.length = 0;
  state.preparationError = null;
  state.providerResultsByScope =
    new WeakMap<object, Map<string, Promise<TestRootResult>>>();
  state.routeResults.length = 0;
  state.transactionDepth = 0;

  mocks.readHostedThreadRouteByThreadIdentity.mockImplementation(async () => {
    state.calls.push(state.transactionDepth > 0 ? "route-tx" : "route-prepare");
    return state.routeResults.length > 0
      ? state.routeResults.shift()
      : buildCanonicalRoute();
  });
  mocks.readActiveHostedMemberAccess.mockImplementation(async () => {
    state.calls.push(state.transactionDepth > 0 ? "access-tx" : "access-prepare");
    return true;
  });
  mocks.unwrapHostedDomainRootForWeb.mockImplementation(async (input: {
    domain: string;
    userId: string;
  }) => {
    state.calls.push(
      state.transactionDepth > 0 ? "unwrap-api-tx" : "unwrap-api-prepare",
    );
    const scope = getHostedDomainRootUnwrapCache();
    const cacheKey = `${input.userId}|${input.domain}`;
    let pending: Promise<TestRootResult> | undefined;
    if (scope) {
      let scoped = state.providerResultsByScope.get(scope);
      if (!scoped) {
        scoped = new Map();
        state.providerResultsByScope.set(scope, scoped);
      }
      pending = scoped.get(cacheKey);
      if (!pending) {
        pending = createProviderRootResult(input.userId);
        scoped.set(cacheKey, pending);
      }
    } else {
      pending = createProviderRootResult(input.userId);
    }
    const result = await pending;
    return {
      envelope: result.envelope,
      rootKey: Uint8Array.from(result.rootKey),
    };
  });
  mocks.acquireHostedLinqChatOwnershipLockTx.mockImplementation(async () => {
    state.calls.push("chat-lock");
  });
  mocks.lockHostedThreadRouteByThreadIdentityTx.mockImplementation(async () => {
    state.calls.push("route-lock");
  });
  mocks.lockAndReadActiveHostedDomainRootKeyIdTx.mockImplementation(async () => {
    state.calls.push("root-lock-read");
    return state.activeRootKeyIds.length > 0
      ? state.activeRootKeyIds.shift()
      : "root_ingress_1";
  });
  mocks.getHostedLinqChatSummary.mockResolvedValue({
    handles: [
      { handle: "+15550000000", isMe: true, status: "active" },
      { handle: "+15551234567", isMe: false, status: "active" },
    ],
    isGroup: true,
  });
  mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx.mockImplementation(
    async (input: {
      envelope: { userId: string };
      tx: Prisma.TransactionClient;
    }) => {
      state.calls.push("append");
      // Mirrors generic mailbox sealing: the transaction asks for the active
      // root again, and the scoped cache must make that local work only.
      const root = await mocks.unwrapHostedDomainRootForWeb({
        domain: "ingress",
        prisma: input.tx,
        userId: input.envelope.userId,
      });
      root.rootKey.fill(0);
      return buildMailboxAppendResult();
    },
  );
  mocks.signalHostedMailboxAppendRuntime.mockImplementation(async () => {
    state.calls.push("signal");
    return {
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_group_123",
    };
  });
});

afterEach(() => {
  delete process.env.HOSTED_CONTACT_PRIVACY_KEYS;
  delete process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
  clearHostedOnboardingEnvCache();
});

describe("stageHostedLinqGroupReactionContext", () => {
  it("prepares the exact route and ingress root before BEGIN, then revalidates under lock", async () => {
    const prisma = createPrismaStub();

    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({ reactionType: "laugh" }),
      prisma,
    })).resolves.toBe(true);

    expect(state.calls).toEqual([
      "route-prepare",
      "access-prepare",
      "unwrap-api-prepare",
      "provider-unwrap",
      "begin",
      "chat-lock",
      "route-lock",
      "route-tx",
      "access-tx",
      "root-lock-read",
      "append",
      "unwrap-api-tx",
      "commit",
      "signal",
    ]);
    expect(mocks.lockHostedThreadRouteByThreadIdentityTx).toHaveBeenCalledWith({
      authority: {
        channel: "linq",
        containerMemberId: "member_group_123",
        threadId: "chat_group_123",
      },
      prisma: prisma.__transactionClient,
    });
    expect(mocks.lockAndReadActiveHostedDomainRootKeyIdTx).toHaveBeenCalledWith({
      domain: "ingress",
      tx: prisma.__transactionClient,
      userId: "member_group_123",
    });
  });

  it("starts zero transactions when mailbox-root preparation fails", async () => {
    const preparationError = new Error("kms unavailable");
    state.preparationError = preparationError;
    const prisma = createPrismaStub();

    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({ reactionType: "laugh" }),
      prisma,
    })).rejects.toBe(preparationError);

    expect(prisma.__transaction).not.toHaveBeenCalled();
    expect(
      mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx,
    ).not.toHaveBeenCalled();
    expect(mocks.providerKmsWork).toHaveBeenCalledExactlyOnceWith({
      transactionOpen: false,
      userId: "member_group_123",
    });
  });

  it("re-prepares once for the winning route and never appends with stale route authority", async () => {
    const losingRoute = buildCanonicalRoute({
      accountLookupKey: "lookup_v1_losing",
      containerMemberId: "member_group_losing",
      deliveryRouteEncrypted: "sealed-route-losing",
      threadIdentityLookupKey: "identity-losing",
      threadLookupKey: "thread-losing",
    });
    const winningRoute = buildCanonicalRoute({
      accountLookupKey: "lookup_v1_winning",
      containerMemberId: "member_group_winning",
      deliveryRouteEncrypted: "sealed-route-winning",
      threadIdentityLookupKey: "identity-winning",
      threadLookupKey: "thread-winning",
    });
    state.routeResults.push(
      losingRoute,
      winningRoute,
      winningRoute,
      winningRoute,
    );
    state.preparedRootKeyIds.push("root_losing", "root_winning");
    state.activeRootKeyIds.push("root_winning");
    const prisma = createPrismaStub();

    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({ reactionType: "laugh" }),
      prisma,
    })).resolves.toBe(true);

    expect(prisma.__transaction).toHaveBeenCalledTimes(2);
    expect(mocks.providerKmsWork.mock.calls).toEqual([
      [{ transactionOpen: false, userId: "member_group_losing" }],
      [{ transactionOpen: false, userId: "member_group_winning" }],
    ]);
    expect(
      mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx,
    ).toHaveBeenCalledTimes(1);
    expect(
      mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx.mock.calls[0]?.[0]
        .envelope,
    ).toMatchObject({
      message: {
        accountLookupKey: "lookup_v1_winning",
        routeAuthority: {
          containerMemberId: "member_group_winning",
        },
      },
      userId: "member_group_winning",
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ expectedUserId: "member_group_winning" }),
    );
  });

  it("re-prepares once when the active ingress root changes", async () => {
    state.preparedRootKeyIds.push("root_ingress_old", "root_ingress_new");
    state.activeRootKeyIds.push("root_ingress_new", "root_ingress_new");
    const prisma = createPrismaStub();

    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({ reactionType: "laugh" }),
      prisma,
    })).resolves.toBe(true);

    expect(prisma.__transaction).toHaveBeenCalledTimes(2);
    expect(mocks.providerKmsWork).toHaveBeenCalledTimes(2);
    expect(
      mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx,
    ).toHaveBeenCalledTimes(1);
    expect(
      mocks.lockAndReadActiveHostedDomainRootKeyIdTx,
    ).toHaveBeenCalledTimes(2);
  });

  it("does no provider or KMS work after the transaction starts", async () => {
    const prisma = createPrismaStub();

    await stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({ reactionType: "laugh" }),
      prisma,
    });

    expect(mocks.unwrapHostedDomainRootForWeb).toHaveBeenCalledTimes(2);
    expect(mocks.providerKmsWork).toHaveBeenCalledExactlyOnceWith({
      transactionOpen: false,
      userId: "member_group_123",
    });
    expect(state.calls).toContain("unwrap-api-tx");
  });

  it.each([
    ["laugh", undefined, "added", "laugh"],
    ["dislike", undefined, "added", "dislike"],
    ["emphasize", undefined, "added", "emphasize"],
    ["question", undefined, "added", "question"],
    ["custom", "😂", "added", "😂"],
    ["custom", "🔥", "added", "🔥"],
    ["heart", undefined, "removed", "heart"],
  ])(
    "persists %s %s as a consumed mailbox conversation item",
    async (reactionType, customEmoji, operation, expectedReaction) => {
      const eventType = operation === "removed"
        ? "reaction.removed"
        : "reaction.added";
      const prisma = createPrismaStub();

      await expect(stageHostedLinqGroupReactionContext({
        event: buildReactionEvent({
          customEmoji,
          eventType,
          reactionType,
        }),
        prisma,
      })).resolves.toBe(true);

      expect(mocks.getHostedLinqChatSummary).not.toHaveBeenCalled();
      expect(
        mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx,
      ).toHaveBeenCalledTimes(1);
      const appendInput =
        mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx.mock.calls[0]?.[0];
      const envelope = appendInput?.envelope;
      expect(envelope).toMatchObject({
        eventId: "group-reaction:event_reaction_123",
        kind: "conversation.message",
        message: {
          accountLookupKey: "lookup_v1_test",
          channel: "linq",
          linqMessage: {
            chatId: "chat_group_123",
            from: "group-reaction",
            isFromMe: false,
            messageId: "group-reaction:event_reaction_123",
            reactionEligible: false,
            replyToMessageId: "message_target_123",
            threadIsDirect: false,
          },
          routeAuthority: {
            channel: "linq",
            containerMemberId: "member_group_123",
            threadId: "chat_group_123",
          },
        },
        occurredAt: "2026-07-14T12:00:00.000Z",
        userId: "member_group_123",
      });
      const text = envelope
        ? readHostedExecutionConversationMessageText(envelope.message)
        : null;
      expect(parseHostedExecutionGroupReactionEventText(text)).toEqual({
        actor: "+15551234567",
        changes: [{
          operation,
          reaction: expectedReaction,
        }],
        channel: "linq",
        mode: "delta",
        schema: "murph.hosted-group-reaction.v1",
        targetMessageId: "message_target_123",
        targetText: null,
      });
      expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
        expectedUserId: "member_group_123",
        knownCheckpoint: {
          lane: "conversation",
          laneSeq: "41",
          userId: "member_group_123",
        },
        mailboxItemId: "mailbox_reaction_123",
        prisma,
      });
    },
  );

  it("persists a signed reaction without requiring a current roster read", async () => {
    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({ reactionType: "laugh" }),
      prisma: createPrismaStub(),
    })).resolves.toBe(true);

    expect(mocks.getHostedLinqChatSummary).not.toHaveBeenCalled();
    expect(
      mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx,
    ).toHaveBeenCalledTimes(1);
  });

  it("persists a signed reaction even when the provider omits its value", async () => {
    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({ reactionType: "" }),
      prisma: createPrismaStub(),
    })).resolves.toBe(true);

    const envelope =
      mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx.mock.calls[0]?.[0]
        .envelope;
    const text = readHostedExecutionConversationMessageText(envelope.message);
    expect(parseHostedExecutionGroupReactionEventText(text)).toMatchObject({
      changes: [{ operation: "added", reaction: "unknown" }],
    });
  });

  it("replays byte-identical durable input without reading mutable provider message state", async () => {
    const event = buildReactionEvent({
      customEmoji: "😂",
      reactionType: "custom",
    });
    const prisma = createPrismaStub();

    await stageHostedLinqGroupReactionContext({ event, prisma });
    await stageHostedLinqGroupReactionContext({ event, prisma });

    expect(mocks.getHostedLinqChatSummary).not.toHaveBeenCalled();
    const firstEnvelope =
      mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx.mock.calls[0]?.[0]
        .envelope;
    const secondEnvelope =
      mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx.mock.calls[1]?.[0]
        .envelope;
    expect(secondEnvelope).toEqual(firstEnvelope);
    const text = readHostedExecutionConversationMessageText(firstEnvelope.message);
    expect(parseHostedExecutionGroupReactionEventText(text)).toMatchObject({
      targetMessageId: "message_target_123",
      targetText: null,
    });
  });

  it("preserves the exact reacted part index without copying mutable target text", async () => {
    await stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({ partIndex: 1, reactionType: "laugh" }),
      prisma: createPrismaStub(),
    });

    const envelope =
      mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx.mock.calls[0]?.[0]
        .envelope;
    const text = readHostedExecutionConversationMessageText(envelope.message);
    expect(parseHostedExecutionGroupReactionEventText(text)).toMatchObject({
      targetText: null,
    });
    expect(envelope.message.linqMessage.replyToPartIndex).toBe(1);
  });

  it("rejects self echoes, missing routes, and inactive containers", async () => {
    const prisma = createPrismaStub();

    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({ isFromMe: true, reactionType: "laugh" }),
      prisma,
    })).resolves.toBe(false);

    mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValueOnce(null);
    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({ reactionType: "laugh" }),
      prisma,
    })).resolves.toBe(false);

    mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValueOnce({
      containerMemberId: "member_group_123",
    });
    mocks.readActiveHostedMemberAccess.mockResolvedValueOnce(false);
    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({ reactionType: "laugh" }),
      prisma,
    })).resolves.toBe(false);

    expect(
      mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx,
    ).not.toHaveBeenCalled();
    expect(prisma.__transaction).not.toHaveBeenCalled();
  });

  it("fails the webhook when the durable append or signal fails so a provider retry can replay it", async () => {
    mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx.mockRejectedValueOnce(
      new Error("mailbox unavailable"),
    );
    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({ reactionType: "laugh" }),
      prisma: createPrismaStub(),
    })).rejects.toThrow("mailbox unavailable");

    mocks.signalHostedMailboxAppendRuntime.mockRejectedValueOnce(
      new Error("signal unavailable"),
    );
    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({ reactionType: "laugh" }),
      prisma: createPrismaStub(),
    })).rejects.toThrow("signal unavailable");
  });
});

describe("appendHostedLinqGroupReactionMailboxTx", () => {
  it("lets canonical offer owners retain a reaction without exposing its pre-member handle", async () => {
    const tx = {} as Prisma.TransactionClient;
    const event = buildReactionEvent({ reactionType: "like" });

    await expect(appendHostedLinqGroupReactionMailboxTx({
      actor: null,
      event,
      route: {
        accountLookupKey: "lookup_v1_test",
        containerMemberId: "member_group_123",
      },
      tx,
    })).resolves.toEqual({
      containerMemberId: "member_group_123",
      item: {
        id: "mailbox_reaction_123",
        lane: "conversation",
        laneSeq: "41",
      },
    });

    const appendInput =
      mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx.mock.calls[0]?.[0];
    const text = readHostedExecutionConversationMessageText(
      appendInput.envelope.message,
    );
    expect(parseHostedExecutionGroupReactionEventText(text)).toEqual({
      actor: null,
      changes: [{ operation: "added", reaction: "like" }],
      channel: "linq",
      mode: "delta",
      schema: "murph.hosted-group-reaction.v1",
      targetMessageId: "message_target_123",
      targetText: null,
    });
    expect(appendInput.tx).toBe(tx);
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });
});

describe("buildHostedLinqAffirmativeReactionMessageEvent", () => {
  it.each([
    ["like", undefined, "Reacted with a like reaction."],
    ["heart", undefined, "Reacted with a heart reaction."],
    ["custom", "👍", "Reacted with 👍."],
    ["custom", "❤", "Reacted with ❤."],
  ])(
    "keeps qualifying %s additions on the ordinary durable reply path",
    async (reactionType, customEmoji, expectedText) => {
      await expect(buildHostedLinqAffirmativeReactionMessageEvent({
        event: buildReactionEvent({ customEmoji, reactionType }),
      })).resolves.toMatchObject({
        data: {
          message: {
            id: "event_reaction_123",
            parts: [{ type: "text", value: expectedText }],
            reply_to: { message_id: "message_target_123" },
          },
        },
        event_id: "event_reaction_123",
        event_type: "message.received",
      });
    },
  );

  it("leaves laughs and removals on the consumed context-only path", async () => {
    await expect(buildHostedLinqAffirmativeReactionMessageEvent({
      event: buildReactionEvent({ reactionType: "laugh" }),
    })).resolves.toBeNull();
    await expect(buildHostedLinqAffirmativeReactionMessageEvent({
      event: buildReactionEvent({
        eventType: "reaction.removed",
        reactionType: "heart",
      }),
    })).resolves.toBeNull();
  });
});

function buildReactionEvent(input: {
  customEmoji?: string;
  eventType?: "reaction.added" | "reaction.removed";
  isFromMe?: boolean;
  partIndex?: number;
  reactionType?: string;
} = {}) {
  const parsed = parseHostedLinqProviderEvent({
    event: {
      api_version: "v3",
      created_at: "2026-07-14T12:00:00.000Z",
      data: {
        chat_id: "chat_group_123",
        custom_emoji: input.customEmoji,
        from: "+15551234567",
        is_from_me: input.isFromMe ?? false,
        message_id: "message_target_123",
        part_index: input.partIndex,
        reaction_type: input.reactionType ?? "like",
      },
      event_id: "event_reaction_123",
      event_type: input.eventType ?? "reaction.added",
      trace_id: "trace_reaction_123",
      webhook_version: "2026-02-03",
    } as HostedLinqWebhookEvent,
  });
  if (!parsed) {
    throw new Error("Expected reaction provider event to parse.");
  }
  return parsed;
}

type TestPrismaClient = PrismaClient & {
  __transaction: ReturnType<typeof vi.fn>;
  __transactionClient: Prisma.TransactionClient;
};

function createPrismaStub(): TestPrismaClient {
  const transactionClient = {} as Prisma.TransactionClient;
  const transaction = vi.fn(
    async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      state.calls.push("begin");
      state.transactionDepth += 1;
      try {
        const result = await callback(transactionClient);
        state.calls.push("commit");
        return result;
      } catch (error) {
        state.calls.push("rollback");
        throw error;
      } finally {
        state.transactionDepth -= 1;
      }
    },
  );
  return Object.assign(Object.create(null), {
    $transaction: transaction,
    __transaction: transaction,
    __transactionClient: transactionClient,
  }) as TestPrismaClient;
}

function buildCanonicalRoute(input: {
  accountLookupKey?: string;
  containerMemberId?: string;
  deliveryRouteEncrypted?: string;
  threadIdentityLookupKey?: string;
  threadLookupKey?: string;
} = {}) {
  const deliveryRouteEncrypted =
    input.deliveryRouteEncrypted ?? "sealed-route-default";
  return {
    accountLookupKey: input.accountLookupKey ?? "lookup_v1_test",
    channel: "linq",
    container: {
      billingStatus: "active",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      id: input.containerMemberId ?? "member_group_123",
      suspendedAt: null,
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    containerMemberId: input.containerMemberId ?? "member_group_123",
    deliveryRouteState: {
      deliveryRouteEncrypted,
      deliveryRouteEncryptedPresent: deliveryRouteEncrypted.length > 0,
      threadIdentityLookupKey:
        input.threadIdentityLookupKey ?? "identity-route-default",
      threadLookupKey: input.threadLookupKey ?? "thread-route-default",
    },
    owner: {
      billingStatus: "active",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      id: "member_owner_123",
      suspendedAt: null,
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  };
}

function createProviderRootResult(userId: string): Promise<TestRootResult> {
  state.calls.push("provider-unwrap");
  mocks.providerKmsWork({
    transactionOpen: state.transactionDepth > 0,
    userId,
  });
  if (state.preparationError) {
    return Promise.reject(state.preparationError);
  }
  return Promise.resolve({
    envelope: {
      rootKeyId: state.preparedRootKeyIds.shift() ?? "root_ingress_1",
    },
    rootKey: new Uint8Array([1, 2, 3, 4]),
  });
}

function buildMailboxAppendResult() {
  return {
    dedupeConflict: false,
    duplicate: false,
    inserted: true,
    item: {
      id: "mailbox_reaction_123",
      lane: "conversation" as const,
      laneSeq: "41",
    },
  };
}

function configureHostedContactPrivacyKeyringForTest(): void {
  process.env.HOSTED_CONTACT_PRIVACY_KEYS = `v1:${TEST_CONTACT_PRIVACY_KEY}`;
  process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = "v1";
  clearHostedOnboardingEnvCache();
}

function clearHostedOnboardingEnvCache(): void {
  delete (
    globalThis as typeof globalThis & {
      __murphHostedOnboardingEnv?: unknown;
    }
  ).__murphHostedOnboardingEnv;
}
