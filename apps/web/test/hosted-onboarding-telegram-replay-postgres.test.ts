import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  prisma: null as PrismaClient | null,
  signal: vi.fn(),
  completion: vi.fn(),
  destination: vi.fn(),
  threadRoute: vi.fn(),
}));
vi.mock("@/src/lib/prisma", async (original) => ({
  ...await original<typeof import("@/src/lib/prisma")>(),
  getPrisma: () => {
    if (!mocks.prisma) throw new Error("Missing synthetic database fixture.");
    return mocks.prisma;
  },
}));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: vi.fn() }));
vi.mock("@/src/lib/hosted-mailbox/encryption", async (original) => ({
  ...await original<typeof import("@/src/lib/hosted-mailbox/encryption")>(),
  // Crypto is outside this database proof; admission, claim and append stay real.
  encryptPreparedHostedMailboxPayloadString: async () => "synthetic-ciphertext",
  encryptHostedMailboxPayloadString: async () => "synthetic-ciphertext",
}));
vi.mock("@/src/lib/hosted-mailbox/runtime-access", async (original) => ({
  ...await original<typeof import("@/src/lib/hosted-mailbox/runtime-access")>(),
  requireHostedRuntimeActiveAccess: async () => undefined,
  hasHostedRuntimeActiveAccessForUpdateTx: async () => true,
}));
vi.mock("@/src/lib/hosted-routing/assistant-notification-destination", async (original) => ({
  ...await original<typeof import("@/src/lib/hosted-routing/assistant-notification-destination")>(),
  resolveHostedAssistantNotificationDestination: mocks.destination,
  assertHostedAssistantNotificationRouteAuthority: async () => undefined,
}));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", async (original) => ({
  ...await original<typeof import("@/src/lib/hosted-orchestration/signal-runtime")>(),
  signalHostedMailboxAppendRuntime: mocks.signal,
}));
vi.mock("@/src/lib/hosted-polls/completion", () => ({ readPollCompletion: mocks.completion }));
vi.mock("@/src/lib/hosted-routing/thread-route-store", async (original) => ({
  ...await original<typeof import("@/src/lib/hosted-routing/thread-route-store")>(),
  readHostedThreadRouteByThreadIdentity: mocks.threadRoute,
}));
vi.mock("@/src/lib/hosted-onboarding/member-access", async (original) => ({
  ...await original<typeof import("@/src/lib/hosted-onboarding/member-access")>(),
  readActiveHostedMemberAccess: async () => true,
}));

import { POST } from "../app/api/hosted-onboarding/telegram/webhook/route";
import { createPrismaClient } from "@/src/lib/prisma";
import { createHostedTelegramPollLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import { telegramPollSnapshot } from "@/src/lib/hosted-polls/provider";
import * as pollStore from "@/src/lib/hosted-polls/store";
import * as mailbox from "@/src/lib/hosted-mailbox/store";
import * as reactionMailbox from "@/src/lib/hosted-onboarding/group-reaction-mailbox";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.search || !/^\/murph_test(?:_[a-z0-9_]+)?$/u.test(url.pathname)) {
    throw new Error("Telegram poll proof requires an explicitly selected local test database.");
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "synthetic-secret");
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.signal.mockResolvedValue(undefined);
  mocks.completion.mockResolvedValue({ reason: "majority", eligibleCount: 3 });
});

describe.skipIf(!enabled)("Telegram webhook PostgreSQL redelivery", () => {
  it("rolls back a partially stored reaction and deduplicates its committed redelivery", async () => withFixture(async (f) => {
    const append = reactionMailbox.appendConsumedHostedGroupReactionMailboxEnvelopeTx;
    vi.spyOn(reactionMailbox, "appendConsumedHostedGroupReactionMailboxEnvelopeTx").mockImplementationOnce(async (input) => {
      await append(input);
      throw new TypeError("Synthetic reaction transaction failure");
    });
    const reaction = { update_id: 12, message_reaction: {
      chat: { id: -42, type: "group" }, date: 1_785_000_000, message_id: 17,
      old_reaction: [], new_reaction: [{ type: "emoji", emoji: "👍" }],
    } };
    expect((await f.deliver(reaction)).status).toBe(500);
    expect((await f.rows()).mailbox).toEqual([]);
    expect((await f.deliver(reaction)).status).toBe(202);
    const committed = (await f.rows()).mailbox;
    expect(committed).toHaveLength(1);
    expect(committed[0]?.consumedAt).not.toBeNull();
    const replay = await f.deliver(reaction);
    expect(replay.status).toBe(202);
    expect(await replay.json()).toMatchObject({ duplicate: true });
    expect((await f.rows()).mailbox).toEqual(committed);
  }));

  it("accepts duplicate success and a lost response with one tally and notification", async () => withFixture(async (f) => {
    expect((await f.deliver()).status).toBe(202);
    const accepted = await f.rows();
    expect(accepted.mailbox).toHaveLength(1);
    expect((await f.deliver()).status).toBe(202);
    expect(await f.rows()).toEqual(accepted);
  }));

  it.each([TypeError, RangeError, URIError, SyntaxError])("recovers %s after tally commit without applying it twice", async (Fault) => withFixture(async (f) => {
    mocks.completion.mockRejectedValueOnce(new Fault("Synthetic notification preparation failure"));
    expect((await f.deliver()).status).toBe(500);
    const partial = await f.rows();
    expect(partial.poll.lastUpdateId).toBe(10n);
    expect(partial.poll.resultNotifiedAt).toBeNull();
    expect(partial.mailbox).toEqual([]);
    expect((await f.deliver()).status).toBe(202);
    const accepted = await f.rows();
    expect(accepted.poll.resultEncrypted).toBe(partial.poll.resultEncrypted);
    expect(accepted.mailbox).toHaveLength(1);
    expect((await f.deliver()).status).toBe(202);
    expect(await f.rows()).toEqual(accepted);
  }));

  it("rolls back the notification claim when append fails and retries exactly once", async () => withFixture(async (f) => {
    vi.spyOn(mailbox, "appendPreparedHostedMailboxEnvelopeTx").mockRejectedValueOnce(new TypeError("Synthetic append failure"));
    expect((await f.deliver()).status).toBe(500);
    expect((await f.rows()).poll.resultNotifiedAt).toBeNull();
    expect((await f.rows()).mailbox).toEqual([]);
    expect((await f.deliver()).status).toBe(202);
    expect((await f.rows()).mailbox).toHaveLength(1);
  }));

  it("recovers a failed post-commit signal using the existing notification", async () => withFixture(async (f) => {
    mocks.signal.mockRejectedValueOnce(new TypeError("Synthetic signal failure"));
    expect((await f.deliver()).status).toBe(500);
    const committed = await f.rows();
    expect(committed.mailbox).toHaveLength(1);
    expect((await f.deliver()).status).toBe(202);
    expect(await f.rows()).toEqual(committed);
    expect(mocks.signal).toHaveBeenCalledTimes(2);
  }));

  it("redelivers a committed named vote after response encoding fails without rewriting it", async () => withFixture(async (f) => {
    vi.spyOn(NextResponse, "json").mockImplementationOnce(() => {
      throw new TypeError("Synthetic response encoding failure");
    });
    const answer = { poll_id: f.poll.id, user: { id: 17, first_name: "Synthetic" }, option_ids: [0] };
    expect((await f.deliver({ update_id: 11, poll_answer: answer })).status).toBe(500);
    const votes = await f.prisma.hostedConversationPollVote.findMany({ where: { pollId: f.id } });
    expect(votes).toHaveLength(1);
    expect((await f.deliver({ update_id: 11, poll_answer: answer })).status).toBe(202);
    expect(await f.prisma.hostedConversationPollVote.findMany({ where: { pollId: f.id } })).toEqual(votes);
  }));
});

async function withFixture(run: (fixture: Awaited<ReturnType<typeof seed>>) => Promise<void>) {
  const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
  const memberId = `synthetic-poll-${randomUUID()}`;
  mocks.prisma = prisma;
  try {
    await prisma.hostedMember.create({ data: { id: memberId } });
    await run(await seed(prisma, memberId));
  } finally {
    await prisma.hostedMember.deleteMany({ where: { id: memberId } });
    await prisma.$disconnect();
    mocks.prisma = null;
  }
}

async function seed(prisma: PrismaClient, memberId: string) {
  const id = `poll_${randomUUID().replaceAll("-", "")}`;
  const poll = { id: randomUUID(), question: "Day?", options: [{ text: "First", voter_count: 2 }, { text: "Second", voter_count: 0 }], total_voter_count: 2, is_closed: false, is_anonymous: false, allows_multiple_answers: false };
  const identity = { id, memberId };
  const target = "42";
  mocks.threadRoute.mockResolvedValue({ containerMemberId: memberId });
  mocks.destination.mockResolvedValue({
    conversationShape: "direct-member", externalThreadRouteAuthority: null,
    route: { channel: "telegram", actorId: null, identityId: null, threadId: target, threadIsDirect: true, delivery: { kind: "thread", target } },
  });
  await prisma.hostedConversationPoll.create({ data: {
    ...identity, channel: "telegram", conversationKey: id,
    providerPollKey: createHostedTelegramPollLookupKey(poll.id),
    definitionEncrypted: await pollStore.encryptPoll(identity, "definition", { schema: "murph.conversation-poll.v1", target, question: poll.question, options: ["First", "Second"] }),
    resultEncrypted: await pollStore.encryptPoll(identity, "result", { schema: "murph.conversation-poll-result.v1", messageId: "17", providerPollId: poll.id, snapshot: telegramPollSnapshot(poll, id, "creation") }),
  } });
  return {
    prisma, poll, id,
    deliver: (body: unknown = { update_id: 10, poll }) => POST(new Request("https://example.test/api/hosted-onboarding/telegram/webhook", {
      body: JSON.stringify(body), method: "POST", headers: { "x-telegram-bot-api-secret-token": "synthetic-secret" },
    })),
    rows: async () => ({
      poll: await prisma.hostedConversationPoll.findUniqueOrThrow({ where: { id } }),
      mailbox: await prisma.hostedMailboxItem.findMany({ where: { userId: memberId } }),
    }),
  };
}
