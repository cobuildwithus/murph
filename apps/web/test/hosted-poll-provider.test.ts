import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), vote: vi.fn(), telegram: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/linq/api", () => ({ runLinqApiRequest: (input: { request: (client: unknown) => unknown }) => input.request({ chats: { polls: { create: mocks.post } }, messages: { poll: { retrieve: mocks.get, vote: mocks.vote } } }) }));
vi.mock("../src/lib/hosted-onboarding/runtime", () => ({ requireHostedOnboardingLinqConfig: () => ({ apiBaseUrl: "https://provider.invalid", apiToken: "synthetic" }) }));
vi.mock("../src/lib/hosted-onboarding/telegram-client", () => ({ callHostedTelegramApi: mocks.telegram }));
import { callLinqPoll, callTelegramPoll } from "../src/lib/hosted-polls/provider";
const pollRef = "poll_" + "a".repeat(32);
const telegramPoll = { id: "provider-poll", question: "Day?", options: [{ text: "Saturday", voter_count: 2 }, { text: "Sunday", voter_count: 1 }], total_voter_count: 3, is_closed: false, is_anonymous: true, allows_multiple_answers: false };
describe("native poll providers", () => {
  beforeEach(() => vi.clearAllMocks());
  it("uses Linq's native endpoint and a stable creation key", async () => {
    mocks.post.mockResolvedValue({ chat_id: "chat", message_id: "message", poll: { options: [{ text: "Saturday", voters: [] }, { text: "Sunday", voters: [] }], total_voters: 0 } });
    const result = await callLinqPoll({ action: "create", chatId: "chat", pollRef, question: "Day?", options: ["Saturday", "Sunday"] });
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith("chat", { poll: { options: [{ text: "Saturday" }, { text: "Sunday" }], idempotency_key: pollRef } });
    expect(result.snapshot).toMatchObject({ totalVoters: 0, anonymous: false, multipleAnswers: true });
  });
  it("returns Linq voter handles and every selected option independently of distinct totals", async () => {
    mocks.get.mockResolvedValue({ chat_id: "chat", message_id: "message", poll: { options: [{ text: "Saturday", voters: [{ handle: "private-handle" }] }, { text: "Sunday", voters: [{ handle: "private-handle" }] }], total_voters: 1 } });
    const result = await callLinqPoll({ action: "read", chatId: "chat", pollRef, question: "Day?", messageId: "message" });
    expect(result.snapshot.options.map((option) => option.votes)).toEqual([1, 1]);
    expect(result.snapshot.totalVoters).toBe(1);
    expect(result.snapshot.voters).toEqual([expect.objectContaining({ kind: "imessage_handle", id: "private-handle", optionIndexes: [0, 1] })]);
    expect(result.snapshot.voterSource).toBe("provider_read");
    expect(mocks.get).toHaveBeenCalledWith("message");
  });
  it("rejects another chat's Linq results", async () => {
    mocks.get.mockResolvedValue({ chat_id: "other", message_id: "message", poll: { options: [], total_voters: 0 } });
    await expect(callLinqPoll({ action: "read", chatId: "chat", pollRef, question: "Day?", messageId: "message" })).rejects.toThrow();
  });
  it.each(["add", "remove"] as const)("submits an explicit %s for the sending line and returns provider counts", async (operation) => {
    const optionId = "00000000-0000-4000-8000-000000000002";
    const envelope = { chat_id: "chat", message_id: "message", poll: { options: [{ option_id: optionId, text: "Sunday", voters: operation === "add" ? [{ handle: "murph@example.test" }] : [] }], total_voters: operation === "add" ? 1 : 0 } };
    mocks.get.mockResolvedValue(envelope);
    expect((await callLinqPoll({ action: "read", chatId: "chat", pollRef, question: "Day?", messageId: "message" })).optionIds).toEqual([optionId]);
    mocks.vote.mockResolvedValue(envelope);
    const result = await callLinqPoll({ action: "vote", chatId: "chat", pollRef, question: "Day?", messageId: "message", optionId, operation });
    expect(mocks.vote).toHaveBeenCalledExactlyOnceWith("message", { option_id: optionId, operation });
    expect(result.snapshot.totalVoters).toBe(operation === "add" ? 1 : 0);
    expect(JSON.stringify(result.snapshot)).not.toContain(optionId);
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it("does not confirm failed or misrouted votes", async () => {
    const input = { action: "vote" as const, chatId: "chat", pollRef, question: "Day?", messageId: "message", optionId: "00000000-0000-4000-8000-000000000001", operation: "add" as const };
    mocks.vote.mockRejectedValueOnce(new Error("Lost acknowledgement"));
    await expect(callLinqPoll(input)).rejects.toThrow("could not be confirmed");
    mocks.vote.mockResolvedValueOnce({ chat_id: "other", message_id: "message", poll: { options: [], total_voters: 0 } });
    await expect(callLinqPoll(input)).rejects.toThrow("could not be confirmed");
    expect(mocks.vote).toHaveBeenCalledTimes(2);
  });
  it("preserves Telegram forum routing and sends only once", async () => {
    mocks.telegram.mockResolvedValue({ ok: true, result: { message_id: 17, chat: { id: -100 }, poll: telegramPoll } });
    const result = await callTelegramPoll({ action: "create", target: "-100:topic:12", pollRef, question: "Day?", options: ["Saturday", "Sunday"] });
    expect(mocks.telegram).toHaveBeenCalledExactlyOnceWith({ method: "sendPoll", readJson: true, body: { chat_id: "-100", message_thread_id: 12, question: "Day?", options: [{ text: "Saturday" }, { text: "Sunday" }], is_anonymous: true, allows_multiple_answers: false } });
    expect(result.snapshot.totalVoters).toBe(3);
  });
  it.each([true, false])("honors Telegram anonymity=%s", async (anonymous) => {
    mocks.telegram.mockResolvedValue({ ok: true, result: { message_id: 17, chat: { id: -100 }, poll: { ...telegramPoll, is_anonymous: anonymous } } });
    const result = await callTelegramPoll({ action: "create", target: "-100", pollRef, question: "Day?", options: ["Saturday", "Sunday"], anonymous });
    expect(mocks.telegram).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ is_anonymous: anonymous }) }));
    expect(result.snapshot.anonymous).toBe(anonymous);
  });
  it("pages iMessage identities without losing aggregate counts", async () => {
    const voters = Array.from({ length: 51 }, (_, i) => ({ handle: `synthetic-${String(i).padStart(2, "0")}` }));
    mocks.get.mockResolvedValue({ chat_id: "chat", message_id: "message", poll: { options: [{ text: "Saturday", voters }], total_voters: 51 } });
    const first = await callLinqPoll({ action: "read", chatId: "chat", pollRef, question: "Day?", messageId: "message" });
    expect(first.snapshot.voters).toHaveLength(50);
    expect(first.snapshot.nextVoterCursor).toBe("50");
    const second = await callLinqPoll({ action: "read", chatId: "chat", pollRef, question: "Day?", messageId: "message", voterCursor: first.snapshot.nextVoterCursor! });
    expect(second.snapshot.voters).toHaveLength(1);
    expect(second.snapshot.totalVoters).toBe(51);
    expect(second.snapshot.nextVoterCursor).toBeNull();
  });
  it("closes explicitly without sending a replacement", async () => {
    mocks.telegram.mockResolvedValue({ ok: true, result: { ...telegramPoll, is_closed: true } });
    const result = await callTelegramPoll({ action: "close", target: "-100", pollRef, messageId: "17" });
    expect(mocks.telegram).toHaveBeenCalledExactlyOnceWith({ method: "stopPoll", readJson: true, body: { chat_id: "-100", message_id: 17 } });
    expect(result.snapshot.closed).toBe(true);
  });
  it("rejects Telegram channel direct messages before provider work", async () => {
    await expect(callTelegramPoll({ action: "create", target: "-100:dm-topic:12", pollRef, question: "Day?", options: ["Saturday", "Sunday"] })).rejects.toThrow();
    expect(mocks.telegram).not.toHaveBeenCalled();
  });
});
