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
      parts: [{ type: "text", value: "A useful group message" }],
    });
    mocks.appendHostedLinqThreadRouteReactionContextTx.mockResolvedValue("appended");
  });

  afterEach(() => {
    restoreContactPrivacyKeyring?.();
    restoreContactPrivacyKeyring = null;
  });

  it("stages bounded generic context for the account-bound active group", async () => {
    const event = buildReactionEvent({
      customEmoji: "🔥",
      reactionType: "custom",
    });
    const prisma = createPrismaStub();
    mocks.getHostedLinqReactionTargetMessage.mockResolvedValue({
      chatId: "chat_group_123",
      id: "message_target_123",
      parts: [
        { type: "text", value: "x".repeat(400) },
        { type: "descriptor", value: "[link]" },
      ],
    });

    await expect(stageHostedLinqGroupReactionContext({
      event,
      prisma,
    })).resolves.toEqual({ status: "staged" });

    expect(mocks.readHostedThreadRouteByThreadIdentity).toHaveBeenCalledWith({
      accountLookupKey: expect.stringMatching(/^hbidx:phone:/u),
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
        /^A participant added a custom reaction on: x+ \[truncated\]$/u,
      ),
      threadId: "chat_group_123",
    });
    expect(appendInput?.text.length).toBeLessThanOrEqual(370);
    expect(appendInput?.text).not.toContain("+15551234567");
    expect(appendInput?.text).not.toContain("🔥");
    expect(appendInput?.text).not.toContain("https://");
  });

  it("ignores a missing or inactive account-bound route before provider reads", async () => {
    const prisma = createPrismaStub();
    mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValueOnce(null);

    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent(),
      prisma,
    })).resolves.toEqual({
      reason: "route_unavailable",
      status: "ignored",
    });

    mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValueOnce({
      containerMemberId: "member_group_123",
    });
    mocks.readActiveHostedMemberAccess.mockResolvedValueOnce(false);

    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent(),
      prisma,
    })).resolves.toEqual({
      reason: "route_unavailable",
      status: "ignored",
    });

    expect(mocks.getHostedLinqChatSummary).not.toHaveBeenCalled();
    expect(mocks.getHostedLinqReactionTargetMessage).not.toHaveBeenCalled();
    expect(mocks.appendHostedLinqThreadRouteReactionContextTx).not.toHaveBeenCalled();
  });

  it("ignores direct chats and actors absent from the current active roster", async () => {
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
    })).resolves.toEqual({
      reason: "invalid_group",
      status: "ignored",
    });

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
    })).resolves.toEqual({
      reason: "invalid_actor",
      status: "ignored",
    });

    expect(mocks.getHostedLinqReactionTargetMessage).not.toHaveBeenCalled();
    expect(mocks.appendHostedLinqThreadRouteReactionContextTx).not.toHaveBeenCalled();
  });

  it("ignores a target that does not exactly match the reacted message and chat", async () => {
    const prisma = createPrismaStub();
    mocks.getHostedLinqReactionTargetMessage.mockResolvedValue({
      chatId: "chat_other_123",
      id: "message_target_123",
      parts: [{ type: "text", value: "A message from another chat" }],
    });

    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent(),
      prisma,
    })).resolves.toEqual({
      reason: "invalid_target",
      status: "ignored",
    });

    expect(mocks.appendHostedLinqThreadRouteReactionContextTx).not.toHaveBeenCalled();
  });
});

function buildReactionEvent(input: {
  customEmoji?: string;
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
        line: { phone_number: "+15550000000" },
        message_id: "message_target_123",
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
  return {
    $transaction: vi.fn(
      async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        callback(transactionClient),
    ),
  } as PrismaClient;
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
