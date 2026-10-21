vi.mock("../src/lib/hosted-polls/notification", () => ({ maybeNotifyPollResult: vi.fn() }));
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ findFirst: vi.fn(), updateMany: vi.fn(), readResult: vi.fn(), encrypt: vi.fn() }));
vi.mock("../src/lib/prisma", () => ({ getPrisma: () => ({ hostedConversationPoll: { findFirst: m.findFirst, updateMany: m.updateMany } }) }));
vi.mock("../src/lib/hosted-onboarding/contact-privacy", () => ({ createHostedTelegramPollLookupKeyReadCandidates: (id: string) => ["blinded:" + id] }));
vi.mock("../src/lib/hosted-polls/store", () => ({ readPollResult: m.readResult, encryptPoll: m.encrypt }));
import { maybeNotifyPollResult } from "../src/lib/hosted-polls/notification";
import { handleHostedTelegramPollWebhook } from "../src/lib/hosted-polls/telegram-webhook";
const pollRef = "poll_" + "a".repeat(32);
const poll = { id: "provider-poll", question: "Day?", options: [{ text: "Saturday", voter_count: 2 }, { text: "Sunday", voter_count: 1 }], total_voter_count: 3, is_closed: false, is_anonymous: true, allows_multiple_answers: false };
const row = { id: pollRef, memberId: "member_synthetic", lastUpdateId: 9n, closedAt: null };
describe("Telegram poll tally webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks(); m.findFirst.mockResolvedValue(row);
    m.readResult.mockResolvedValue({ schema: "murph.conversation-poll-result.v1", messageId: "17", providerPollId: "provider-poll", snapshot: { anonymous: true, options: [{ text: "Saturday", votes: 0 }, { text: "Sunday", votes: 0 }] } });
    m.encrypt.mockResolvedValue("encrypted-tally"); m.updateMany.mockResolvedValue({ count: 1 });
  });
  it("stores a bound tally before evaluating its result notification", async () => {
    await expect(handleHostedTelegramPollWebhook(JSON.stringify({ update_id: 10, poll }))).resolves.toEqual({ ok: true });
    expect(maybeNotifyPollResult).toHaveBeenCalledWith(expect.objectContaining({ resultEncrypted: "encrypted-tally", lastUpdateId: 10n }));
    expect(m.findFirst).toHaveBeenCalledWith({ where: { channel: "telegram", providerPollKey: { in: ["blinded:provider-poll"] } } });
    expect(m.encrypt).toHaveBeenCalledWith(row, "result", expect.objectContaining({ messageId: "17", snapshot: expect.objectContaining({ totalVoters: 3, freshness: "provider_update" }) }));
    expect(m.updateMany).toHaveBeenCalledWith({ where: { id: pollRef, closedAt: null, OR: [{ lastUpdateId: null }, { lastUpdateId: { lt: 10n } }] }, data: { resultEncrypted: "encrypted-tally", lastUpdateId: 10n } });
  });
  it.each([9, 8])("ignores duplicate and older update %s", async (update_id) => {
    await handleHostedTelegramPollWebhook(JSON.stringify({ update_id, poll }));
    expect(maybeNotifyPollResult).toHaveBeenCalledWith(row);
    expect(m.encrypt).not.toHaveBeenCalled(); expect(m.updateMany).not.toHaveBeenCalled();
  });
  it("never reopens a closed poll from a delayed update", async () => {
    m.findFirst.mockResolvedValue({ ...row, closedAt: new Date() });
    await handleHostedTelegramPollWebhook(JSON.stringify({ update_id: 10, poll }));
    expect(m.updateMany).not.toHaveBeenCalled();
  });
  it("asks Telegram to retry when a poll creation can still be binding", async () => {
    m.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: pollRef });
    await expect(handleHostedTelegramPollWebhook(JSON.stringify({ update_id: 10, poll }))).rejects.toMatchObject({ httpStatus: 503 });
    expect(m.updateMany).not.toHaveBeenCalled();
  });
  it("keeps an immediate vote when creation commits between the two lookups", async () => {
    m.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(row);
    expect(await handleHostedTelegramPollWebhook(JSON.stringify({ update_id: 10, poll }))).toEqual({ ok: true });
    expect(m.findFirst).toHaveBeenCalledTimes(3);
    expect(m.updateMany).toHaveBeenCalledTimes(1);
    expect(m.encrypt).toHaveBeenCalledWith(row, "result", expect.objectContaining({ snapshot: expect.objectContaining({ totalVoters: 3 }) }));
  });
  it("ignores unowned poll ids and leaves ordinary messages to the normal handler", async () => {
    m.findFirst.mockResolvedValue(null);
    expect(await handleHostedTelegramPollWebhook(JSON.stringify({ update_id: 10, poll }))).toEqual({ ok: true, ignored: true });
    expect(await handleHostedTelegramPollWebhook(JSON.stringify({ update_id: 11, message: { text: "hello" } }))).toBeNull();
  });
});
