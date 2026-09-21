import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), telegram: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/linq/api", () => ({ runLinqApiRequest: (input: { request: (client: unknown) => unknown }) => input.request({ chats: { polls: { create: mocks.post } }, messages: { poll: { retrieve: mocks.get } } }) }));
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
  it("counts Linq selections separately from distinct voters and drops voter handles", async () => {
    mocks.get.mockResolvedValue({ chat_id: "chat", message_id: "message", poll: { options: [{ text: "Saturday", voters: [{ handle: "private-handle" }] }, { text: "Sunday", voters: [{ handle: "private-handle" }] }], total_voters: 1 } });
    const result = await callLinqPoll({ action: "read", chatId: "chat", pollRef, question: "Day?", messageId: "message" });
    expect(result.snapshot.options.map((option) => option.votes)).toEqual([1, 1]);
    expect(result.snapshot.totalVoters).toBe(1);
    expect(JSON.stringify(result)).not.toContain("private-handle");
    expect(mocks.get).toHaveBeenCalledWith("message");
  });
  it("rejects another chat's Linq results", async () => {
    mocks.get.mockResolvedValue({ chat_id: "other", message_id: "message", poll: { options: [], total_voters: 0 } });
    await expect(callLinqPoll({ action: "read", chatId: "chat", pollRef, question: "Day?", messageId: "message" })).rejects.toThrow();
  });
  it("preserves Telegram forum routing and sends only once", async () => {
    mocks.telegram.mockResolvedValue({ ok: true, result: { message_id: 17, chat: { id: -100 }, poll: telegramPoll } });
    const result = await callTelegramPoll({ action: "create", target: "-100:topic:12", pollRef, question: "Day?", options: ["Saturday", "Sunday"] });
    expect(mocks.telegram).toHaveBeenCalledExactlyOnceWith({ method: "sendPoll", readJson: true, body: { chat_id: "-100", message_thread_id: 12, question: "Day?", options: [{ text: "Saturday" }, { text: "Sunday" }], is_anonymous: true, allows_multiple_answers: false } });
    expect(result.snapshot.totalVoters).toBe(3);
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

