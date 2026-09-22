import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedConversationPoll, HostedConversationPollVote } from "@prisma/client";
import type { ConversationPollSnapshot } from "@murphai/hosted-execution/conversation-polls";
const m = vi.hoisted(() => ({
  votes: new Map<string, HostedConversationPollVote>(), findPoll: vi.fn(), findVote: vi.fn(), findVotes: vi.fn(),
  insert: vi.fn(), update: vi.fn(), updatePoll: vi.fn(), readResult: vi.fn(), encryptPoll: vi.fn(), seal: vi.fn(), open: vi.fn(),
}));
vi.mock("../src/lib/prisma", () => ({ getPrisma: () => ({
  hostedConversationPoll: { findFirst: m.findPoll, updateMany: m.updatePoll },
  hostedConversationPollVote: { findFirst: m.findVote, findMany: m.findVotes, createMany: m.insert, updateMany: m.update },
}) }));
vi.mock("../src/lib/hosted-onboarding/contact-privacy", () => ({
  createHostedTelegramPollLookupKeyReadCandidates: (id: string) => ["blinded:" + id],
  createHostedTelegramUserLookupKey: (id: string) => "blinded:" + id,
  createHostedTelegramUserLookupKeyReadCandidates: (id: string) => ["blinded:" + id],
}));
vi.mock("../src/lib/hosted-polls/store", () => ({ readPollResult: m.readResult, encryptPoll: m.encryptPoll }));
vi.mock("../src/lib/hosted-crypto/secure-box", () => ({ sealHostedUserSecureBoxString: m.seal, openHostedUserSecureBoxStrings: m.open }));
import { handleHostedTelegramPollWebhook } from "../src/lib/hosted-polls/telegram-webhook";
import { withTelegramPollVoters } from "../src/lib/hosted-polls/votes";
const pollRef = "poll_" + "a".repeat(32);
const row: HostedConversationPoll = { id: pollRef, memberId: "synthetic-member", channel: "telegram", conversationKey: "synthetic-conversation", providerPollKey: "blinded:provider-poll", definitionEncrypted: "definition", resultEncrypted: "result", dispatchedAt: new Date(), lastUpdateId: 1000n, closedAt: null, createdAt: new Date(), updatedAt: new Date() };
const snapshot: ConversationPollSnapshot = { pollRef, channel: "telegram", question: "Day?", options: [{ text: "Saturday", votes: 1 }, { text: "Sunday", votes: 0 }], totalVoters: 1, anonymous: false, closed: false, multipleAnswers: false, observedAt: new Date().toISOString(), freshness: "provider_update" };
const answer = { poll_id: "provider-poll", user: { id: 17, first_name: "Riley", last_name: "Example", username: "synthetic_riley" }, option_ids: [0] };
const key = (vote: Pick<HostedConversationPollVote, "pollId" | "voterKey">) => vote.pollId + ":" + vote.voterKey;
const deliver = (update_id: number, poll_answer = answer) => handleHostedTelegramPollWebhook(JSON.stringify({ update_id, poll_answer }));

describe("named Telegram poll votes", () => {
  beforeEach(() => {
    vi.clearAllMocks(); m.votes.clear(); m.findPoll.mockResolvedValue({ ...row });
    m.readResult.mockResolvedValue({ schema: "murph.conversation-poll-result.v1", messageId: "17", providerPollId: "provider-poll", snapshot });
    m.findVote.mockImplementation(async ({ where }: { where: { pollId: string; voterKey: { in: string[] } } }) =>
      [...m.votes.values()].find((vote) => vote.pollId === where.pollId && where.voterKey.in.includes(vote.voterKey)) ?? null);
    m.findVotes.mockImplementation(async ({ where, take }: { where: { pollId: string; voterKey?: { gt: string } }; take: number }) =>
      [...m.votes.values()].filter((vote) => vote.pollId === where.pollId && vote.hasVote && (!where.voterKey || vote.voterKey > where.voterKey.gt)).sort((a, b) => a.voterKey.localeCompare(b.voterKey)).slice(0, take));
    m.insert.mockImplementation(async ({ data }: { data: HostedConversationPollVote[] }) => {
      const vote = data[0]!;
      if (m.votes.has(key(vote))) return { count: 0 };
      m.votes.set(key(vote), { ...vote }); return { count: 1 };
    });
    m.update.mockImplementation(async ({ where, data }: { where: { pollId: string; voterKey: string; lastUpdateId: { lt: bigint } }; data: Partial<HostedConversationPollVote> }) => {
      const vote = m.votes.get(key(where));
      if (!vote || vote.lastUpdateId >= where.lastUpdateId.lt) return { count: 0 };
      Object.assign(vote, data); return { count: 1 };
    });
    m.seal.mockImplementation(async ({ value }: { value: string }) => "sealed:" + value);
    m.open.mockImplementation(async ({ entries }: { entries: { value: string }[] }) => entries.map((entry) => entry.value.slice(7)));
  });
  it("exposes the actual voter and choices only inside an authorized poll read", async () => {
    await deliver(10);
    const result = await withTelegramPollVoters(row, snapshot);
    expect(result.voters).toEqual([expect.objectContaining({ kind: "telegram_user", id: "17", displayName: "Riley Example", username: "synthetic_riley", optionIndexes: [0] })]);
    expect(result.voterSource).toBe("received_updates");
    expect(m.seal).toHaveBeenCalledWith(expect.objectContaining({ lane: "hosted-member-private-field", userId: row.memberId, aad: expect.objectContaining({ table: "hosted_conversation_poll_vote" }) }));
    expect(m.findVotes).toHaveBeenCalledWith(expect.objectContaining({ where: { pollId: row.id, hasVote: true }, take: 51 }));
  });
  it("keeps vote changes and retractions ordered per voter, independently of tallies", async () => {
    await deliver(10); await deliver(12, { ...answer, option_ids: [1] }); await deliver(11);
    expect((await withTelegramPollVoters(row, snapshot)).voters?.[0]?.optionIndexes).toEqual([1]);
    await deliver(13, { ...answer, option_ids: [] }); await deliver(12);
    expect((await withTelegramPollVoters(row, snapshot)).voters).toEqual([]);
    expect([...m.votes.values()][0]?.lastUpdateId).toBe(13n);
    await deliver(9, { ...answer, user: { ...answer.user, id: 18 } });
    expect((await withTelegramPollVoters(row, snapshot)).voters?.[0]?.id).toBe("18");
  });
  it("guards concurrent first answers and keeps a late answer after close", async () => {
    await Promise.all([deliver(22, { ...answer, option_ids: [1] }), deliver(21)]);
    m.findPoll.mockResolvedValue({ ...row, closedAt: new Date() });
    await deliver(20, { ...answer, user: { ...answer.user, id: 18 } });
    const result = await withTelegramPollVoters(row, { ...snapshot, closed: true });
    expect(result.voters).toHaveLength(2);
    expect(result.voters?.find((voter) => voter.id === "17")?.optionIndexes).toEqual([1]);
    expect(result.closed).toBe(true);
  });
  it("never stores or exposes identity on an anonymous poll", async () => {
    m.readResult.mockResolvedValue({ providerPollId: "provider-poll", snapshot: { ...snapshot, anonymous: true } });
    expect(await deliver(10)).toEqual({ ok: true, ignored: true });
    expect(await withTelegramPollVoters(row, { ...snapshot, anonymous: true })).toMatchObject({ voters: [], voterSource: "anonymous", nextVoterCursor: null });
    expect(m.seal).not.toHaveBeenCalled(); expect(m.findVotes).not.toHaveBeenCalled();
  });
  it("keeps a chat voter as a chat without inventing a person", async () => {
    await handleHostedTelegramPollWebhook(JSON.stringify({ update_id: 10, poll_answer: { poll_id: "provider-poll", voter_chat: { id: -100, title: "Synthetic Club" }, option_ids: [1] } }));
    expect((await withTelegramPollVoters(row, snapshot)).voters).toEqual([expect.objectContaining({ kind: "telegram_chat", id: "-100", displayName: "Synthetic Club", optionIndexes: [1] })]);
  });
  it("returns bounded pages and does not confuse an incomplete voter page with totals", async () => {
    for (let i = 0; i < 51; i++) await deliver(i, { ...answer, user: { ...answer.user, id: i + 100 } });
    const first = await withTelegramPollVoters(row, { ...snapshot, totalVoters: 70 });
    expect(first.voters).toHaveLength(50); expect(first.totalVoters).toBe(70);
    expect(first.nextVoterCursor).toBeTypeOf("string");
    const second = await withTelegramPollVoters(row, snapshot, first.nextVoterCursor!);
    expect(second.voters).toHaveLength(1); expect(second.nextVoterCursor).toBeNull();
  });
  it("retains an answer when creation binds between the initial and pending lookups", async () => {
    m.findPoll.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(row);
    expect(await deliver(10)).toEqual({ ok: true });
    expect((await withTelegramPollVoters(row, snapshot)).voters).toHaveLength(1);
  });
  it("rejects invalid choices before storing them", async () => {
    await expect(deliver(10, { ...answer, option_ids: [2] })).rejects.toThrow("out of range");
    expect(m.insert).not.toHaveBeenCalled();
  });
});
