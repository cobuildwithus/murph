import type { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedLinqThreadRouteReactionContextTx: vi.fn(),
  getHostedLinqChatSummary: vi.fn(),
  getHostedLinqReactionTargetMessage: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  readHostedThreadRouteByThreadIdentity: vi.fn(),
}));

vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  appendHostedLinqThreadRouteReactionContextTx:
    mocks.appendHostedLinqThreadRouteReactionContextTx,
  readHostedThreadRouteByThreadIdentity:
    mocks.readHostedThreadRouteByThreadIdentity,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-client", () => ({
  getHostedLinqChatSummary: mocks.getHostedLinqChatSummary,
  getHostedLinqReactionTargetMessage:
    mocks.getHostedLinqReactionTargetMessage,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
}));

import type { HostedLinqWebhookEvent } from "@/src/lib/hosted-onboarding/linq";
import { parseHostedLinqProviderEvent } from "@/src/lib/hosted-onboarding/linq-provider-events";
import {
  buildHostedLinqAffirmativeReactionMessageEvent,
  stageHostedLinqGroupReactionContext,
} from "@/src/lib/hosted-onboarding/webhook-provider-linq-reaction-context";

const TEST_CONTACT_PRIVACY_KEY =
  "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=";

describe("stageHostedLinqGroupReactionContext", () => {
  let restoreContactPrivacyKeyring: (() => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    restoreContactPrivacyKeyring = configureHostedContactPrivacyKeyringForTest();
    mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValue({
      containerMemberId: "member_group_123",
    });
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);
    mocks.getHostedLinqChatSummary.mockResolvedValue({
      handles: [
        {
          handle: "+15550000000",
          isMe: true,
          status: "active",
        },
        {
          handle: "+15551234567",
          isMe: false,
          status: "active",
        },
      ],
      isGroup: true,
    });
    mocks.getHostedLinqReactionTargetMessage.mockResolvedValue({
      chatId: "chat_group_123",
      id: "message_target_123",
      isFromMe: false,
      parts: ["A useful group message"],
      service: "iMessage",
    });
    mocks.appendHostedLinqThreadRouteReactionContextTx.mockResolvedValue("appended");
  });

  afterEach(() => {
    restoreContactPrivacyKeyring?.();
    restoreContactPrivacyKeyring = null;
  });

  it("stages bounded actor-attributed context for the account-bound active group", async () => {
    const event = buildReactionEvent({
      customEmoji: "🔥",
      reactionType: "custom",
    });
    const prisma = createPrismaStub();
    mocks.getHostedLinqReactionTargetMessage.mockResolvedValue({
      chatId: "chat_group_123",
      id: "message_target_123",
      parts: [
        "x".repeat(400),
        "[link]",
      ],
    });

    await expect(stageHostedLinqGroupReactionContext({
      event,
      prisma,
    })).resolves.toBe(true);

    expect(mocks.readHostedThreadRouteByThreadIdentity).toHaveBeenCalledWith({
      channel: "linq",
      prisma,
      threadId: "chat_group_123",
    });
    expect(mocks.readActiveHostedMemberAccess).toHaveBeenCalledWith({
      memberId: "member_group_123",
      prisma,
    });
    expect(mocks.appendHostedLinqThreadRouteReactionContextTx).toHaveBeenCalledTimes(1);
    const appendInput = mocks.appendHostedLinqThreadRouteReactionContextTx.mock.calls[0]?.[0];
    expect(appendInput).toMatchObject({
      accountLookupKey: expect.stringMatching(/^hbidx:phone:/u),
      containerMemberId: "member_group_123",
      text: expect.stringMatching(
        /^Participant \+15551234567 added a custom reaction on: x+ \[truncated\]$/u,
      ),
      threadId: "chat_group_123",
    });
    expect(appendInput?.text.length).toBeLessThanOrEqual(512);
    expect(appendInput?.text).toContain("+15551234567");
    expect(appendInput?.text).not.toContain("🔥");
    expect(appendInput?.text).not.toContain("https://");
  });

  it("ignores a missing or inactive route before provider reads", async () => {
    const prisma = createPrismaStub();
    mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValueOnce(null);

    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent(),
      prisma,
    })).resolves.toBe(false);

    mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValueOnce({
      containerMemberId: "member_group_123",
    });
    mocks.readActiveHostedMemberAccess.mockResolvedValueOnce(false);

    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent(),
      prisma,
    })).resolves.toBe(false);

    expect(mocks.getHostedLinqChatSummary).not.toHaveBeenCalled();
    expect(mocks.getHostedLinqReactionTargetMessage).not.toHaveBeenCalled();
    expect(mocks.appendHostedLinqThreadRouteReactionContextTx).not.toHaveBeenCalled();
  });

  it("ignores a canonical self-reaction before route or provider reads", async () => {
    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({ isFromMe: true }),
      prisma: createPrismaStub(),
    })).resolves.toBe(false);

    expect(mocks.readHostedThreadRouteByThreadIdentity).not.toHaveBeenCalled();
    expect(mocks.getHostedLinqChatSummary).not.toHaveBeenCalled();
    expect(mocks.getHostedLinqReactionTargetMessage).not.toHaveBeenCalled();
  });

  it("ignores direct chats and stale self or actor roster entries", async () => {
    const prisma = createPrismaStub();
    mocks.getHostedLinqChatSummary.mockResolvedValueOnce({
      handles: [
        { handle: "+15550000000", isMe: true, status: "active" },
        { handle: "+15551234567", isMe: false, status: "active" },
      ],
      isGroup: false,
    });

    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent(),
      prisma,
    })).resolves.toBe(false);

    mocks.getHostedLinqChatSummary.mockResolvedValueOnce({
      handles: [
        { handle: "+15550000000", isMe: true, status: "removed" },
        { handle: "+15551234567", isMe: false, status: "active" },
      ],
      isGroup: true,
    });

    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent(),
      prisma,
    })).resolves.toBe(false);

    mocks.getHostedLinqChatSummary.mockResolvedValueOnce({
      handles: [
        { handle: "+15550000000", isMe: true, status: "active" },
        { handle: "+15551234567", isMe: false, status: "removed" },
      ],
      isGroup: true,
    });

    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent(),
      prisma,
    })).resolves.toBe(false);

    mocks.getHostedLinqChatSummary.mockResolvedValueOnce({
      handles: [
        { handle: "+15550000000", isMe: true, status: null },
        { handle: "+15551234567", isMe: false, status: "active" },
      ],
      isGroup: true,
    });

    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent(),
      prisma,
    })).resolves.toBe(false);

    mocks.getHostedLinqChatSummary.mockResolvedValueOnce({
      handles: [
        { handle: "+15550000000", isMe: true, status: "active" },
        { handle: "+15551234567", isMe: false, status: null },
      ],
      isGroup: true,
    });

    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent(),
      prisma,
    })).resolves.toBe(false);

    expect(mocks.getHostedLinqReactionTargetMessage).not.toHaveBeenCalled();
    expect(mocks.appendHostedLinqThreadRouteReactionContextTx).not.toHaveBeenCalled();
  });

  it("ignores a target that does not exactly match the reacted message and chat", async () => {
    const prisma = createPrismaStub();
    mocks.getHostedLinqReactionTargetMessage.mockResolvedValue({
      chatId: "chat_other_123",
      id: "message_target_123",
      parts: ["A message from another chat"],
    });

    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent(),
      prisma,
    })).resolves.toBe(false);

    expect(mocks.appendHostedLinqThreadRouteReactionContextTx).not.toHaveBeenCalled();
  });

  it("uses only the reacted part and rejects an out-of-range part index", async () => {
    const prisma = createPrismaStub();
    mocks.getHostedLinqReactionTargetMessage.mockResolvedValue({
      chatId: "chat_group_123",
      id: "message_target_123",
      parts: ["first part", "second part"],
    });

    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({ partIndex: 1 }),
      prisma,
    })).resolves.toBe(true);
    expect(
      mocks.appendHostedLinqThreadRouteReactionContextTx.mock.calls[0]?.[0].text,
    ).toBe(
      "Participant +15551234567 added a like reaction on: second part",
    );

    mocks.appendHostedLinqThreadRouteReactionContextTx.mockClear();
    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({ partIndex: 2 }),
      prisma,
    })).resolves.toBe(false);
    expect(mocks.appendHostedLinqThreadRouteReactionContextTx).not.toHaveBeenCalled();
  });

  it("drops optional context when transactional staging fails", async () => {
    mocks.appendHostedLinqThreadRouteReactionContextTx.mockRejectedValueOnce(
      new DOMException("timed out", "TimeoutError"),
    );

    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent(),
      prisma: createPrismaStub(),
    })).resolves.toBe(false);
  });

  it.each([false, true])(
    "promotes an exact Murph-authored affirmative reaction through the ordinary %s group flag",
    async (isGroup) => {
      mocks.getHostedLinqChatSummary.mockResolvedValueOnce({
        handles: [
          { handle: "+15550000000", isMe: true, status: "active" },
          { handle: "+15551234567", isMe: false, status: "active" },
        ],
        isGroup,
      });
      mocks.getHostedLinqReactionTargetMessage.mockResolvedValueOnce({
        chatId: "chat_group_123",
        id: "message_target_123",
        isFromMe: true,
        parts: ["Would you like me to continue?"],
        service: "iMessage",
      });

      await expect(buildHostedLinqAffirmativeReactionMessageEvent({
        event: buildReactionEvent(),
      })).resolves.toMatchObject({
        data: {
          chat: {
            id: "chat_group_123",
            is_group: isGroup,
          },
          from: "+15551234567",
          is_from_me: false,
          message: {
            id: "message_target_123",
            parts: [
              {
                type: "text",
                value: expect.stringContaining("affirmative reply"),
              },
              {
                type: "text",
                value: expect.stringContaining("Would you like me to continue?"),
              },
            ],
            reply_to: {
              message_id: "message_target_123",
            },
          },
        },
        event_id: "event_reaction_123",
        event_type: "message.received",
      });
    },
  );

  it.each([
    [
      "self-line",
      [
        { handle: "+15550000000", isMe: true, status: "active" },
        { handle: "+15550000001", isMe: true, status: "active" },
        { handle: "+15551234567", isMe: false, status: "active" },
      ],
    ],
    [
      "actor",
      [
        { handle: "+15550000000", isMe: true, status: "active" },
        { handle: "+15551234567", isMe: false, status: "active" },
        { handle: "+15551234567", isMe: false, status: "active" },
      ],
    ],
  ])("rejects an ambiguous active %s roster", async (_kind, handles) => {
    mocks.getHostedLinqChatSummary.mockResolvedValueOnce({
      handles,
      isGroup: false,
    });
    mocks.getHostedLinqReactionTargetMessage.mockResolvedValueOnce({
      chatId: "chat_group_123",
      id: "message_target_123",
      isFromMe: true,
      parts: ["Would you like me to continue?"],
      service: "iMessage",
    });

    await expect(buildHostedLinqAffirmativeReactionMessageEvent({
      event: buildReactionEvent(),
    })).resolves.toBeNull();
  });

  it("keeps nonaffirmative and participant-target reactions on the silent path", async () => {
    await expect(buildHostedLinqAffirmativeReactionMessageEvent({
      event: buildReactionEvent({
        customEmoji: "😂",
        reactionType: "custom",
      }),
    })).resolves.toBeNull();
    expect(mocks.getHostedLinqReactionTargetMessage).not.toHaveBeenCalled();

    mocks.getHostedLinqReactionTargetMessage.mockResolvedValueOnce({
      chatId: "chat_group_123",
      id: "message_target_123",
      isFromMe: false,
      parts: ["Participant-authored message"],
      service: "iMessage",
    });
    await expect(buildHostedLinqAffirmativeReactionMessageEvent({
      event: buildReactionEvent(),
    })).resolves.toBeNull();
  });
});

function buildReactionEvent(input: {
  customEmoji?: string;
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
      event_type: "reaction.added",
      trace_id: "trace_reaction_123",
      webhook_version: "2026-02-03",
    } as HostedLinqWebhookEvent,
  });
  if (!parsed) {
    throw new Error("Expected reaction provider event to parse.");
  }
  return parsed;
}

function createPrismaStub(): PrismaClient {
  const transactionClient = {} as Prisma.TransactionClient;
  const prisma: PrismaClient = Object.assign(Object.create(null), {
    $transaction: vi.fn(
      async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        callback(transactionClient),
    ),
  });
  return prisma;
}

function configureHostedContactPrivacyKeyringForTest(): () => void {
  const previousKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
  const previousCurrentVersion = process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
  process.env.HOSTED_CONTACT_PRIVACY_KEYS = `v1:${TEST_CONTACT_PRIVACY_KEY}`;
  process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = "v1";
  clearHostedOnboardingEnvCache();

  return () => {
    restoreEnvValue("HOSTED_CONTACT_PRIVACY_KEYS", previousKeys);
    restoreEnvValue(
      "HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION",
      previousCurrentVersion,
    );
    clearHostedOnboardingEnvCache();
  };
}

function clearHostedOnboardingEnvCache(): void {
  delete (
    globalThis as typeof globalThis & {
      __murphHostedOnboardingEnv?: unknown;
    }
  ).__murphHostedOnboardingEnv;
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
