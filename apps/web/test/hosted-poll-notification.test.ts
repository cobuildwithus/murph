import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedConversationPoll } from "@prisma/client";
const m = vi.hoisted(() => ({ claim: vi.fn(), prepare: vi.fn(), append: vi.fn(), read: vi.fn(), active: vi.fn(), activeTx: vi.fn(), destination: vi.fn(), authority: vi.fn(), signal: vi.fn(), completion: vi.fn(), definition: vi.fn(), result: vi.fn() }));
vi.mock("../src/lib/prisma", () => ({ getPrisma: () => ({ $transaction: async (fn: (tx: unknown) => unknown) => fn({ hostedConversationPoll: { updateMany: m.claim } }) }) }));
vi.mock("../src/lib/hosted-mailbox/store", () => ({ prepareHostedMailboxEnvelopeAppend: m.prepare, appendPreparedHostedMailboxEnvelopeTx: m.append, readHostedMailboxItemByDedupeKey: m.read }));
vi.mock("../src/lib/hosted-mailbox/runtime-access", () => ({ requireHostedRuntimeActiveAccess: m.active, hasHostedRuntimeActiveAccessForUpdateTx: m.activeTx, isHostedRuntimeInactiveAccessError: (e: Error) => e.message === "inactive" }));
vi.mock("../src/lib/hosted-routing/assistant-notification-destination", () => ({ resolveHostedAssistantNotificationDestination: m.destination, bindHostedAssistantNotificationDestination: ({ destination }: { destination: unknown }) => destination, assertHostedAssistantNotificationRouteAuthority: m.authority }));
vi.mock("../src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedMailboxAppendRuntime: m.signal }));
vi.mock("../src/lib/hosted-polls/completion", () => ({ readPollCompletion: m.completion }));
vi.mock("../src/lib/hosted-polls/store", () => ({ readPollDefinition: m.definition, readPollResult: m.result }));
import { maybeNotifyPollResult } from "../src/lib/hosted-polls/notification";
const row: HostedConversationPoll = { id: "poll_" + "a".repeat(32), memberId: "synthetic-member", channel: "telegram", conversationKey: "blinded-chat", providerPollKey: "blinded-poll", definitionEncrypted: "definition", resultEncrypted: "result-v2", resultNotifiedAt: null, closedAt: null, dispatchedAt: new Date(), lastUpdateId: 2n, createdAt: new Date(), updatedAt: new Date() };
const destination = { route: { channel: "telegram", actorId: null, identityId: null, threadId: "opaque-conversation-id", threadIsDirect: false, delivery: { kind: "thread", target: "-100:topic:12" } }, externalThreadRouteAuthority: { channel: "telegram", containerMemberId: row.memberId, threadId: "-100:topic:12" } };
describe("poll result notification ownership", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.active.mockResolvedValue(undefined); m.activeTx.mockResolvedValue(true); m.destination.mockResolvedValue(destination);
    m.definition.mockResolvedValue({ target: "-100:topic:12" });
    m.result.mockResolvedValue({ snapshot: { pollRef: row.id, channel: "telegram", question: "Picnic day?", options: [{ text: "Saturday", votes: 3 }, { text: "Sunday", votes: 1 }], totalVoters: 4, multipleAnswers: false, closed: false, observedAt: "2026-09-22T12:00:00.000Z" } });
    m.completion.mockResolvedValue({ reason: "majority", eligibleCount: 5 });
    m.claim.mockResolvedValue({ count: 1 }); m.append.mockResolvedValue({ mailboxItemId: "synthetic-mailbox" });
    m.prepare.mockResolvedValue({ mode: "prepared" });
    m.read.mockResolvedValue({ id: "synthetic-mailbox", consumedAt: null });
  });
  it("prepares crypto before the atomic claim/append and signals only after append", async () => {
    await maybeNotifyPollResult(row);
    expect(m.prepare).toHaveBeenCalledWith(expect.objectContaining({ envelope: expect.objectContaining({ kind: "assistant.notification.requested", userId: row.memberId, notification: expect.objectContaining({ ...destination, responsePolicy: { kind: "allow_send_or_skip" }, deliveryIdempotencyKey: `poll-result:${row.id}`, deliveryDispatchMode: "queue-only" }) }) }));
    expect(m.claim).toHaveBeenCalledExactlyOnceWith({ where: { id: row.id, resultNotifiedAt: null, resultEncrypted: "result-v2" }, data: { resultNotifiedAt: expect.any(Date) } });
    expect(m.prepare.mock.invocationCallOrder[0]).toBeLessThan(m.claim.mock.invocationCallOrder[0]!);
    expect(m.claim.mock.invocationCallOrder[0]).toBeLessThan(m.append.mock.invocationCallOrder[0]!);
    expect(m.append.mock.invocationCallOrder[0]).toBeLessThan(m.signal.mock.invocationCallOrder[0]!);
  });
  it("has one append across concurrent threshold attempts", async () => {
    m.claim.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await Promise.all([maybeNotifyPollResult(row), maybeNotifyPollResult(row)]);
    expect(m.append).toHaveBeenCalledTimes(1); expect(m.signal).toHaveBeenCalledTimes(1);
  });
  it("recovers a failed wake signal without creating another notification", async () => {
    m.signal.mockRejectedValueOnce(new Error("temporary signal failure"));
    await expect(maybeNotifyPollResult(row)).rejects.toThrow("temporary signal failure");
    await maybeNotifyPollResult({ ...row, resultNotifiedAt: new Date() });
    expect(m.signal).toHaveBeenCalledTimes(2); expect(m.append).toHaveBeenCalledTimes(1);
    expect(m.completion).toHaveBeenCalledTimes(1);
  });
  it("does not signal an already consumed notification", async () => {
    m.read.mockResolvedValue({ id: "synthetic-mailbox", consumedAt: "2026-09-22T12:01:00Z" });
    await maybeNotifyPollResult({ ...row, resultNotifiedAt: new Date() });
    expect(m.signal).not.toHaveBeenCalled(); expect(m.prepare).not.toHaveBeenCalled();
  });
  it("does not append a stale tally that changed during preparation", async () => {
    m.claim.mockResolvedValue({ count: 0 });
    await maybeNotifyPollResult(row);
    expect(m.append).not.toHaveBeenCalled(); expect(m.signal).not.toHaveBeenCalled();
  });
  it("propagates append failure out of the transaction without signaling", async () => {
    m.append.mockRejectedValue(new Error("append failed"));
    await expect(maybeNotifyPollResult(row)).rejects.toThrow("append failed");
    expect(m.signal).not.toHaveBeenCalled();
    // Both writes execute in the same real Prisma transaction; rejection rolls it back.
  });
  it("stays quiet before a checkpoint and never retargets to another topic", async () => {
    m.completion.mockResolvedValue(null); await maybeNotifyPollResult(row);
    expect(m.prepare).not.toHaveBeenCalled();
    m.destination.mockResolvedValue({ ...destination, route: { ...destination.route, delivery: { kind: "thread", target: "-100:topic:13" } } });
    await maybeNotifyPollResult(row); expect(m.completion).toHaveBeenCalledTimes(1);
  });
  it("rechecks access and route authority before claiming", async () => {
    m.activeTx.mockResolvedValue(false); await maybeNotifyPollResult(row);
    expect(m.claim).not.toHaveBeenCalled();
    m.activeTx.mockResolvedValue(true); m.authority.mockRejectedValue(new Error("route revoked"));
    await expect(maybeNotifyPollResult(row)).rejects.toThrow("route revoked");
    expect(m.claim).not.toHaveBeenCalled();
  });
  it("ignores revoked access but keeps database failures retryable", async () => {
    m.active.mockRejectedValueOnce(new Error("inactive")); await maybeNotifyPollResult(row);
    expect(m.prepare).not.toHaveBeenCalled();
    m.active.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(maybeNotifyPollResult(row)).rejects.toThrow("database unavailable");
  });
});
