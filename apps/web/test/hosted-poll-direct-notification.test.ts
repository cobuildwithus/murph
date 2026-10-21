import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedConversationPoll } from "@prisma/client";
import type { PollResult } from "../src/lib/hosted-polls/store";

const m = vi.hoisted(() => ({
  find: vi.fn(), update: vi.fn(), container: vi.fn(), groupRoutes: vi.fn(),
  member: vi.fn(), active: vi.fn(), activeTx: vi.fn(),
  prepare: vi.fn(), append: vi.fn(), mailbox: vi.fn(), signal: vi.fn(),
  definition: vi.fn(), result: vi.fn(), encrypt: vi.fn(), provider: vi.fn(), chat: vi.fn(),
}));
vi.mock("../src/lib/prisma", () => {
  const db = {
    hostedConversationPoll: { findFirst: m.find, updateMany: m.update },
    hostedThreadContainer: { findUnique: m.container },
    hostedThreadRoute: { findMany: m.groupRoutes },
  };
  return { getPrisma: () => ({ ...db, $transaction: async (fn: (tx: typeof db) => unknown) => fn(db) }) };
});
vi.mock("../src/lib/hosted-onboarding/hosted-member-store", async (original) => ({
  ...await original<typeof import("../src/lib/hosted-onboarding/hosted-member-store")>(),
  readHostedMemberAssistantNotificationState: m.member,
}));
vi.mock("../src/lib/hosted-mailbox/runtime-access", () => ({
  requireHostedRuntimeActiveAccess: m.active,
  hasHostedRuntimeActiveAccessForUpdateTx: m.activeTx,
  isHostedRuntimeInactiveAccessError: () => false,
}));
vi.mock("../src/lib/hosted-mailbox/store", () => ({
  prepareHostedMailboxEnvelopeAppend: m.prepare,
  appendPreparedHostedMailboxEnvelopeTx: m.append,
  readHostedMailboxItemByDedupeKey: m.mailbox,
}));
vi.mock("../src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedMailboxAppendRuntime: m.signal }));
vi.mock("../src/lib/hosted-polls/store", () => ({ readPollDefinition: m.definition, readPollResult: m.result, encryptPoll: m.encrypt }));
vi.mock("../src/lib/hosted-polls/provider", async (original) => ({
  ...await original<typeof import("../src/lib/hosted-polls/provider")>(),
  callLinqPoll: m.provider,
}));
vi.mock("../src/lib/hosted-onboarding/linq-client", async (original) => ({
  ...await original<typeof import("../src/lib/hosted-onboarding/linq-client")>(),
  getHostedLinqChatSummary: m.chat,
}));

import { handleHostedLinqPollWebhook } from "../src/lib/hosted-polls/linq-webhook";
import { handleHostedTelegramPollWebhook } from "../src/lib/hosted-polls/telegram-webhook";

const chatId = "20000000-0000-4000-8000-000000000002";
const messageId = "10000000-0000-4000-8000-000000000001";
const telegramId = "123456";
const member = {
  identity: { phoneLookupKey: "synthetic-contact", phoneNumber: "+15555550100" },
  routing: { linqChatId: chatId, telegramThreadId: telegramId, telegramUserId: "synthetic-telegram-user" },
};
let row: HostedConversationPoll;
let receipt: PollResult;

function configure(channel: "linq" | "telegram") {
  row = { id: "poll_" + "a".repeat(32), memberId: "synthetic-member", channel,
    conversationKey: "blinded-chat", providerPollKey: "blinded-poll",
    definitionEncrypted: "definition", resultEncrypted: "result-v1", resultNotifiedAt: null,
    closedAt: null, dispatchedAt: new Date(), lastUpdateId: 1n, createdAt: new Date(), updatedAt: new Date() };
  receipt = { schema: "murph.conversation-poll-result.v1", messageId, providerPollId: "synthetic-provider-poll", snapshot: {
    pollRef: row.id, channel, question: "Picnic day?", options: [{ text: "Saturday", votes: 1 }, { text: "Sunday", votes: 0 }],
    totalVoters: 1, multipleAnswers: false, closed: false, anonymous: channel === "telegram", freshness: "provider_read", observedAt: "2026-09-22T12:00:00.000Z",
  } };
  m.definition.mockResolvedValue({ target: channel === "linq" ? chatId : telegramId, question: "Picnic day?" });
  m.provider.mockResolvedValue({ snapshot: receipt.snapshot, voterHandlesByOption: [["+15555550100"], []] });
}

async function receive(channel: "linq" | "telegram") {
  if (channel === "linq") return handleHostedLinqPollWebhook({
    api_version: "v3", webhook_version: "2026-02-03", event_id: "synthetic-vote-event",
    event_type: "poll.vote.added", created_at: "2026-09-22T12:00:00Z",
    data: { message_id: messageId, chat: { id: chatId }, service: "iMessage" },
  });
  return handleHostedTelegramPollWebhook(JSON.stringify({ update_id: 2, poll: {
    id: "synthetic-provider-poll", question: "Picnic day?", options: [{ text: "Saturday", voter_count: 1 }, { text: "Sunday", voter_count: 0 }],
    total_voter_count: 1, is_closed: true, is_anonymous: true, type: "regular", allows_multiple_answers: false,
  } }));
}

describe.each(["linq", "telegram"] as const)("direct %s poll webhook notification", (channel) => {
  beforeEach(() => {
    vi.resetAllMocks();
    configure(channel);
    m.find.mockImplementation(async () => ({ ...row }));
    m.result.mockImplementation(async () => receipt);
    m.encrypt.mockImplementation(async (_row, _kind, value: PollResult) => { receipt = value; return "result-v2"; });
    m.update.mockImplementation(async ({ data }: { data: Partial<HostedConversationPoll> }) => { Object.assign(row, data); return { count: 1 }; });
    m.container.mockResolvedValue(null);
    m.groupRoutes.mockResolvedValue([]);
    m.member.mockResolvedValue(member);
    m.active.mockResolvedValue(undefined); m.activeTx.mockResolvedValue(true);
    m.prepare.mockResolvedValue({ mode: "prepared" });
    m.append.mockResolvedValue({ mailboxItemId: "synthetic-mailbox" });
    m.mailbox.mockResolvedValue({ id: "synthetic-mailbox", consumedAt: null });
    m.chat.mockResolvedValue({ handlesComplete: true, handles: [{ handle: "+15555550100", isMe: false, status: "active" }] });
  });

  it("uses the real direct binder and authority check, appends once and recovers replay", async () => {
    await receive(channel);
    expect(m.prepare).toHaveBeenCalledWith(expect.objectContaining({ envelope: expect.objectContaining({
      notification: expect.objectContaining({
        externalThreadRouteAuthority: { channel, containerMemberId: row.memberId, threadId: channel === "linq" ? chatId : telegramId },
        route: expect.objectContaining({ channel, threadIsDirect: true, delivery: {
          kind: channel === "linq" ? "explicit" : "thread", target: channel === "linq" ? chatId : telegramId,
        } }),
      }),
    }) }));
    expect(row.resultNotifiedAt).toBeInstanceOf(Date);
    await receive(channel);
    expect(m.append).toHaveBeenCalledTimes(1);
    expect(m.signal).toHaveBeenCalledTimes(2);
    expect(m.member).toHaveBeenCalledTimes(2);
    expect(m.groupRoutes).not.toHaveBeenCalled();
  });

  it("rejects a destination change between preparation and admission", async () => {
    m.member.mockResolvedValueOnce(member).mockResolvedValue({ ...member, routing: { ...member.routing,
      linqChatId: "30000000-0000-4000-8000-000000000003", telegramThreadId: "654321",
    } });
    await expect(receive(channel)).rejects.toMatchObject({ code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED" });
    expect(row.resultNotifiedAt).toBeNull();
    expect(m.append).not.toHaveBeenCalled(); expect(m.signal).not.toHaveBeenCalled();
  });

  it("does not claim or append when access is revoked during preparation", async () => {
    m.activeTx.mockResolvedValue(false);
    await receive(channel);
    expect(m.prepare).toHaveBeenCalledTimes(1);
    expect(row.resultNotifiedAt).toBeNull();
    expect(m.append).not.toHaveBeenCalled(); expect(m.signal).not.toHaveBeenCalled();
  });
});
