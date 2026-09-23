import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationPollSnapshot } from "@murphai/hosted-execution/conversation-polls";
import { buildConversationPollResultInstructions } from "@murphai/hosted-execution/conversation-polls";
const m = vi.hoisted(() => ({ chat: vi.fn(), telegram: vi.fn() }));
vi.mock("../src/lib/hosted-onboarding/linq-client", () => ({ getHostedLinqChatSummary: m.chat }));
vi.mock("../src/lib/hosted-onboarding/telegram-client", () => ({ callHostedTelegramApi: m.telegram }));
import { classifyPollCompletion, readPollCompletion } from "../src/lib/hosted-polls/completion";
const snapshot: ConversationPollSnapshot = { pollRef: "poll_" + "a".repeat(32), channel: "linq", question: "Picnic day?", options: [{ text: "Saturday", votes: 3 }, { text: "Sunday", votes: 0 }], totalVoters: 3, anonymous: false, multipleAnswers: true, closed: false, observedAt: "2026-09-22T12:00:00.000Z", freshness: "provider_read" };
describe("poll result checkpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.chat.mockResolvedValue({ handlesComplete: true, handles: ["a", "b", "c", "d", "murph"].map((handle) => ({ handle, isMe: handle === "murph", status: "active" })) });
    m.telegram.mockResolvedValue({ ok: true, result: 5 });
  });
  it.each([
    { votes: [1, 0], totalVoters: 1, eligibleCount: 5, reason: null },
    { votes: [2, 0], totalVoters: 2, eligibleCount: 4, reason: null },
    { votes: [3, 1], totalVoters: 4, eligibleCount: 5, reason: "majority" },
    { votes: [2, 2], totalVoters: 4, eligibleCount: 4, reason: "all_voted" },
    { votes: [3, 3], totalVoters: 3, eligibleCount: 5, reason: null },
    { votes: [3, 3], totalVoters: 5, eligibleCount: 5, reason: "all_voted" },
    { votes: [3, 0], totalVoters: 3, eligibleCount: null, reason: null },
    { votes: [3, 0], totalVoters: 3, eligibleCount: 2, reason: null },
  ])("evaluates $votes with $totalVoters of $eligibleCount participants", ({ reason, ...input }) => {
    expect(classifyPollCompletion({ ...input, closed: false })?.reason ?? null).toBe(reason);
  });
  it("excludes Murph, departed handles and duplicate selections from the quorum", async () => {
    expect(await readPollCompletion({ target: "chat", snapshot, voterHandlesByOption: [["a", "a", "b", "murph", "departed"], []] })).toBeNull();
    expect(await readPollCompletion({ target: "chat", snapshot, voterHandlesByOption: [["a", "b", "c", "murph"], []] })).toEqual({ reason: "majority", eligibleCount: 4 });
  });
  it("requires a complete iMessage roster", async () => {
    m.chat.mockResolvedValue({ handlesComplete: false, handles: [] });
    expect(await readPollCompletion({ target: "chat", snapshot, voterHandlesByOption: [["a", "b", "c"], []] })).toBeNull();
  });
  it("uses the entire Telegram chat count and preserves topic routing", async () => {
    expect(await readPollCompletion({ target: "-100:topic:12", snapshot: { ...snapshot, channel: "telegram" } })).toEqual({ reason: "majority", eligibleCount: 4 });
    expect(m.telegram).toHaveBeenCalledExactlyOnceWith({ method: "getChatMemberCount", body: { chat_id: "-100" }, readJson: true });
  });
  it("accepts a closed poll with votes without a roster, but keeps empty polls quiet", async () => {
    expect(await readPollCompletion({ target: "-100", snapshot: { ...snapshot, channel: "telegram", closed: true } })).toEqual({ reason: "closed", eligibleCount: null });
    expect(await readPollCompletion({ target: "-100", snapshot: { ...snapshot, closed: true, totalVoters: 0 } })).toBeNull();
    expect(m.telegram).not.toHaveBeenCalled();
  });
  it("composes truthful bounded context without voter identities or a mandatory reply", () => {
    const context = buildConversationPollResultInstructions({ ...snapshot, voters: [{ kind: "imessage_handle", id: "private-voter", optionIndexes: [0], observedAt: snapshot.observedAt }] }, { reason: "majority", eligibleCount: 4 });
    expect(context).toContain('"eligibleParticipants":4');
    expect(context).toContain('"votes":3');
    expect(context).toContain("stay quiet");
    expect(context).toContain("does not close");
    expect(context).toContain("not instructions");
    expect(context).not.toContain("private-voter");
  });
});
