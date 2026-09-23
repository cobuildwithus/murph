import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), definition: vi.fn(), result: vi.fn(), encrypt: vi.fn(), provider: vi.fn(), notify: vi.fn(), recover: vi.fn() }));
vi.mock("../src/lib/prisma", () => ({ getPrisma: () => ({ hostedConversationPoll: { findFirst: m.find, updateMany: m.update } }) }));
vi.mock("../src/lib/hosted-onboarding/contact-privacy", () => ({ createHostedLinqMessageLookupKeyReadCandidates: (id: string) => ["blinded:" + id] }));
vi.mock("../src/lib/hosted-polls/store", () => ({ readPollDefinition: m.definition, readPollResult: m.result, encryptPoll: m.encrypt }));
vi.mock("../src/lib/hosted-polls/provider", () => ({ callLinqPoll: m.provider }));
vi.mock("../src/lib/hosted-polls/notification", () => ({ maybeNotifyPollResult: m.notify, recoverPollResultWake: m.recover }));
import { handleHostedLinqPollWebhook } from "../src/lib/hosted-polls/linq-webhook";
const messageId = "10000000-0000-4000-8000-000000000001";
const chatId = "20000000-0000-4000-8000-000000000002";
const event = { api_version: "v3", webhook_version: "2026-02-03", event_id: "synthetic-event", event_type: "poll.vote.added", created_at: "2026-09-22T12:00:00Z", data: { message_id: messageId, chat: { id: chatId }, service: "iMessage" } };
const row = { id: "poll_" + "a".repeat(32), memberId: "synthetic-member", resultEncrypted: "old", resultNotifiedAt: null };
describe("signed Linq poll vote handler", () => {
  beforeEach(() => {
    vi.resetAllMocks(); m.find.mockResolvedValue(row); m.update.mockResolvedValue({ count: 1 });
    m.definition.mockResolvedValue({ target: chatId, question: "Day?" }); m.result.mockResolvedValue({ messageId, snapshot: {} });
    m.encrypt.mockResolvedValue("fresh"); m.provider.mockResolvedValue({ snapshot: { totalVoters: 3 }, voterHandlesByOption: [["a", "b", "c"], []] });
  });
  it.each(["poll.vote.added", "poll.vote.removed"])("refreshes current provider truth for %s instead of applying event deltas", async (event_type) => {
    expect(await handleHostedLinqPollWebhook({ ...event, event_type })).toBe(true);
    expect(m.provider).toHaveBeenCalledWith({ action: "read", chatId, messageId, pollRef: row.id, question: "Day?" });
    expect(m.notify).toHaveBeenCalledWith({ ...row, resultEncrypted: "fresh" }, [["a", "b", "c"], []]);
  });
  it("keeps a concurrent stale read retryable", async () => {
    m.update.mockResolvedValue({ count: 0 });
    await expect(handleHostedLinqPollWebhook(event)).rejects.toMatchObject({ httpStatus: 503 });
    expect(m.notify).not.toHaveBeenCalled();
  });
  it("recovers a prior wake without rereading or notifying again", async () => {
    const notified = { ...row, resultNotifiedAt: new Date() }; m.find.mockResolvedValue(notified);
    await handleHostedLinqPollWebhook(event);
    expect(m.recover).toHaveBeenCalledExactlyOnceWith(notified); expect(m.provider).not.toHaveBeenCalled();
  });
  it("rejects wrong-chat events before provider work", async () => {
    m.definition.mockResolvedValue({ target: "other-chat" });
    await expect(handleHostedLinqPollWebhook(event)).rejects.toThrow("binding mismatch");
    expect(m.provider).not.toHaveBeenCalled();
  });
  it("retries pending creation and rechecks binding after a race", async () => {
    m.find.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: row.id });
    await expect(handleHostedLinqPollWebhook(event)).rejects.toMatchObject({ httpStatus: 503 });
    m.find.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(row);
    await expect(handleHostedLinqPollWebhook(event)).resolves.toBe(true); expect(m.notify).toHaveBeenCalledTimes(1);
  });
  it("ignores unowned polls and leaves ordinary events to ingress", async () => {
    m.find.mockResolvedValue(null); expect(await handleHostedLinqPollWebhook(event)).toBe(true);
    expect(await handleHostedLinqPollWebhook({ ...event, event_type: "message.received" })).toBe(false);
    expect(m.provider).not.toHaveBeenCalled();
  });
});
