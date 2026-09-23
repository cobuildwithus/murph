import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedConversationPoll } from "@prisma/client";
const m = vi.hoisted(() => ({
  rows: new Map<string, HostedConversationPoll>(),
  route: { channel: "telegram", target: "-100:topic:12" },
  authorize: vi.fn(), runtime: vi.fn(), active: vi.fn(), telegram: vi.fn(), linq: vi.fn(), question: vi.fn(),
  upsert: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
}));
vi.mock("../src/lib/prisma", () => {
  const db = { hostedConversationPoll: { upsert: m.upsert, findMany: m.findMany, update: m.update, updateMany: m.updateMany } };
  return { getPrisma: () => ({ ...db, $transaction: async (fn: (tx: typeof db) => unknown) => fn(db) }) };
});
vi.mock("../src/lib/hosted-polls/authority", () => ({ authorizePollConversation: m.authorize }));
vi.mock("../src/lib/hosted-execution/runtime-owner", () => ({ requireHostedRuntimeCallbackTx: m.runtime }));
vi.mock("../src/lib/hosted-mailbox/runtime-access", () => ({ requireHostedRuntimeActiveAccessForUpdateTx: m.active }));
vi.mock("../src/lib/hosted-polls/provider", () => ({ callTelegramPoll: m.telegram, callLinqPoll: m.linq }));
vi.mock("../src/lib/hosted-onboarding/linq-client", () => ({ sendHostedLinqChatMessage: m.question }));
vi.mock("../src/lib/hosted-onboarding/contact-privacy", () => ({
  createHostedExternalThreadIdentityLookupKey: (input: { channel: string; threadId: string }) => input.channel + ":" + input.threadId,
  createHostedExternalThreadIdentityLookupKeyReadCandidates: (input: { channel: string; threadId: string }) => [input.channel + ":" + input.threadId],
  createHostedTelegramPollLookupKey: (id: string) => "blinded:" + id,
}));
vi.mock("../src/lib/hosted-crypto/secure-box", () => ({
  sealHostedUserSecureBoxString: async (input: { value: string }) => input.value,
  openHostedUserSecureBoxString: async (input: { value: string }) => input.value,
}));
import { handleHostedConversationPollTool } from "../src/lib/hosted-polls/tool";
import type { ConversationPollAction } from "@murphai/hosted-execution/conversation-polls";

const assistantInputId = "ain_" + "a".repeat(32);
const create: ConversationPollAction = { action: "create", question: "Which day?", options: ["Saturday", "Sunday"] };
function call(request: ConversationPollAction, inputId = assistantInputId) {
  return handleHostedConversationPollTool({ memberId: "member_synthetic", runtimeIdentity: null, request: { assistantInputId: inputId, request } });
}
function created(pollRef: string, channel = "telegram") {
  return { messageId: "17", providerPollId: "provider-poll", snapshot: { pollRef, channel, question: "Which day?", options: [{ text: "Saturday", votes: 0 }, { text: "Sunday", votes: 0 }], totalVoters: 0, anonymous: channel === "telegram", multipleAnswers: channel === "linq", closed: false, observedAt: new Date().toISOString(), freshness: "creation" } };
}
describe("hosted poll effects", () => {
  beforeEach(() => {
    vi.clearAllMocks(); m.rows.clear(); m.route.channel = "telegram"; m.route.target = "-100:topic:12";
    m.authorize.mockImplementation(async () => ({ ...m.route }));
    m.upsert.mockImplementation(async ({ create: data }: { create: Pick<HostedConversationPoll, "id" | "memberId" | "channel" | "conversationKey" | "definitionEncrypted"> }) => {
      const existing = m.rows.get(data.id);
      if (existing) return { ...existing };
      const row = { ...data, providerPollKey: null, resultEncrypted: null, dispatchedAt: null, lastUpdateId: null, closedAt: null, createdAt: new Date(), updatedAt: new Date() };
      m.rows.set(row.id, row); return { ...row };
    });
    m.updateMany.mockImplementation(async ({ where, data }: { where: { id: string }; data: Partial<HostedConversationPoll> }) => {
      const row = m.rows.get(where.id);
      if (!row || row.dispatchedAt) return { count: 0 };
      Object.assign(row, data); return { count: 1 };
    });
    m.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Partial<HostedConversationPoll> }) => {
      const row = m.rows.get(where.id); if (!row) throw new Error("Missing row"); Object.assign(row, data); return { ...row };
    });
    m.findMany.mockImplementation(async ({ where }: { where: { id?: string; memberId: string; conversationKey: { in: string[] } } }) =>
      [...m.rows.values()].filter((row) => row.memberId === where.memberId && where.conversationKey.in.includes(row.conversationKey) && (!where.id || row.id === where.id)));
    m.telegram.mockImplementation(async ({ pollRef }: { pollRef: string }) => {
      expect(m.rows.get(pollRef)?.dispatchedAt).toBeInstanceOf(Date);
      return created(pollRef);
    });
    m.linq.mockImplementation(async ({ pollRef }: { pollRef: string }) => created(pollRef, "linq"));
  });
  it("creates once and reads the same result on replay without another provider effect", async () => {
    const first = await call(create); const second = await call(create);
    expect(first.status).toBe("sent"); expect(second).toEqual(first);
    expect(m.telegram).toHaveBeenCalledTimes(1);
    expect(m.runtime).toHaveBeenCalled();
    const list = await call({ action: "list" }); expect(list.polls).toEqual(first.polls);
    const read = await call({ action: "read", pollRef: first.polls[0]!.pollRef });
    expect(read.polls[0]).toMatchObject(first.polls[0]!);
    expect(read.polls[0]?.voterSource).toBe("anonymous"); expect(m.telegram).toHaveBeenCalledTimes(1);
  });
  it("passes named Telegram mode through the creation receipt and provider", async () => {
    await call({ ...create, anonymous: false });
    expect(m.telegram).toHaveBeenCalledWith(expect.objectContaining({ anonymous: false }));
    await expect(call({ ...create, anonymous: true })).rejects.toThrow("different poll");
  });
  it("rejects anonymous iMessage creation before posting its question", async () => {
    m.route.channel = "linq";
    await expect(call({ ...create, anonymous: true })).rejects.toThrow("cannot be anonymous");
    expect(m.question).not.toHaveBeenCalled(); expect(m.linq).not.toHaveBeenCalled();
  });
  it("retains ambiguous-send claims and refuses changed replay arguments", async () => {
    m.telegram.mockRejectedValueOnce(new Error("Lost acknowledgement"));
    expect(await call(create)).toEqual({ status: "unknown", polls: [] });
    expect(await call(create)).toEqual({ status: "unknown", polls: [] });
    await expect(call({ ...create, question: "Changed" })).rejects.toThrow("different poll");
    expect(m.telegram).toHaveBeenCalledTimes(1);
  });
  it("allows only one provider send across concurrent requests", async () => {
    const responses = await Promise.all([call(create), call(create)]);
    expect(responses.some((response) => response.status === "sent")).toBe(true);
    expect(m.telegram).toHaveBeenCalledTimes(1);
  });
  it("cannot read or close a poll from another topic", async () => {
    const first = await call(create); m.route.target = "-100:topic:13";
    await expect(call({ action: "read", pollRef: first.polls[0]!.pollRef })).rejects.toThrow("not found");
    expect(await call({ action: "list" })).toEqual({ status: "listed", polls: [] });
    expect(m.telegram).toHaveBeenCalledTimes(1);
  });
  it("persists final Telegram counts and reuses an already closed result", async () => {
    const first = await call(create);
    const pollRef = first.polls[0]!.pollRef;
    m.telegram.mockResolvedValueOnce({
      ...created(pollRef), snapshot: { ...created(pollRef).snapshot, closed: true, totalVoters: 3, freshness: "provider_read" },
    });
    const closed = await call({ action: "close", pollRef });
    expect(closed).toMatchObject({ status: "closed", polls: [{ closed: true, totalVoters: 3 }] });
    expect(m.rows.get(pollRef)?.closedAt).toBeInstanceOf(Date);
    expect(await call({ action: "close", pollRef })).toEqual(closed);
    expect(m.telegram).toHaveBeenCalledTimes(2);
  });
  it("sends the iMessage question before its native poll and reads a fresh tally", async () => {
    m.route.channel = "linq"; m.route.target = "chat";
    const first = await call(create);
    expect(m.question).toHaveBeenCalledTimes(1);
    expect(m.question.mock.invocationCallOrder[0]).toBeLessThan(m.linq.mock.invocationCallOrder[0]!);
    m.linq.mockImplementationOnce(async ({ pollRef }: { pollRef: string }) => ({ ...created(pollRef, "linq"), snapshot: { ...created(pollRef, "linq").snapshot, totalVoters: 4, freshness: "provider_read" } }));
    const read = await call({ action: "read", pollRef: first.polls[0]!.pollRef });
    expect(read.polls[0]?.totalVoters).toBe(4);
    await expect(call({ action: "close", pollRef: first.polls[0]!.pollRef })).rejects.toThrow("does not support");
  });
  it.each(["add", "remove"] as const)("resolves the scoped option and reauthorizes before %s", async (operation) => {
    m.route.channel = "linq"; m.route.target = "chat";
    const first = await call(create); const pollRef = first.polls[0]!.pollRef;
    m.linq.mockClear(); m.authorize.mockClear();
    const optionIds = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
    m.linq.mockResolvedValueOnce({ ...created(pollRef, "linq"), optionIds });
    const response = await call({ action: "vote", pollRef, optionIndex: 1, operation });
    expect(response.status).toBe("vote_submitted");
    expect(m.linq).toHaveBeenCalledTimes(2);
    expect(m.linq).toHaveBeenNthCalledWith(1, expect.objectContaining({ action: "read", chatId: "chat", messageId: "17" }));
    expect(m.linq).toHaveBeenNthCalledWith(2, expect.objectContaining({ action: "vote", chatId: "chat", messageId: "17", optionId: optionIds[1], operation }));
    expect(m.authorize).toHaveBeenCalledTimes(2);
    expect(m.authorize.mock.invocationCallOrder[1]).toBeGreaterThan(m.linq.mock.invocationCallOrder[0]!);
    expect(m.authorize.mock.invocationCallOrder[1]).toBeLessThan(m.linq.mock.invocationCallOrder[1]!);
    expect(m.question).toHaveBeenCalledTimes(1);
  });
  it("rejects unsupported Telegram voting without changing counts or calling a provider", async () => {
    const first = await call(create); m.telegram.mockClear();
    await expect(call({ action: "vote", pollRef: first.polls[0]!.pollRef, optionIndex: 0, operation: "add" })).rejects.toThrow("Telegram bots cannot vote");
    expect(m.telegram).not.toHaveBeenCalled(); expect(m.linq).not.toHaveBeenCalled();
    expect((await call({ action: "list" })).polls).toEqual(first.polls);
  });
  it("rejects voting across conversations before provider reads", async () => {
    m.route.channel = "linq"; const first = await call(create); m.linq.mockClear();
    m.route.target = "other-chat";
    await expect(call({ action: "vote", pollRef: first.polls[0]!.pollRef, optionIndex: 0, operation: "add" })).rejects.toThrow("not found");
    expect(m.linq).not.toHaveBeenCalled();
  });
  it.each(["missing-option", "revoked", "changed-route", "lost-ack"])("does not claim a vote after %s", async (failure) => {
    m.route.channel = "linq"; const first = await call(create); const pollRef = first.polls[0]!.pollRef; m.linq.mockClear();
    m.linq.mockImplementationOnce(async () => {
      if (failure === "revoked") m.authorize.mockRejectedValueOnce(new Error("Revoked"));
      if (failure === "changed-route") m.route.target = "other-chat";
      return { ...created(pollRef, "linq"), optionIds: failure === "missing-option" ? [] : ["00000000-0000-4000-8000-000000000001"] };
    });
    if (failure === "lost-ack") m.linq.mockRejectedValueOnce(new Error("Lost acknowledgement"));
    await expect(call({ action: "vote", pollRef, optionIndex: 0, operation: "add" })).rejects.toThrow();
    expect(m.linq).toHaveBeenCalledTimes(failure === "lost-ack" ? 2 : 1);
  });
  it("stops before dispatch when live runtime admission is revoked", async () => {
    m.runtime.mockRejectedValueOnce(new Error("Stale runtime"));
    await expect(call(create)).rejects.toThrow("Stale runtime");
    expect(m.telegram).not.toHaveBeenCalled(); expect(m.rows.size).toBe(0);
  });
});
