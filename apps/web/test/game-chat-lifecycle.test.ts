import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  receipts: vi.fn(), frozen: vi.fn(), recover: vi.fn(), receiptUpdate: vi.fn(), game: vi.fn(), current: vi.fn(), bind: vi.fn(),
  state: vi.fn(), identity: vi.fn(), discover: vi.fn(), exact: vi.fn(), bootstrap: vi.fn(), proposal: vi.fn(),
  destination: vi.fn(), mailbox: vi.fn(), prepare: vi.fn(), append: vi.fn(), signal: vi.fn(), route: vi.fn(),
}));
vi.mock("../src/lib/prisma", () => {
  const db = { hostedLinqDelivery: { findMany: (input: { where: { payloadSchema?: string } }) => input.where.payloadSchema ? m.frozen(input) : m.receipts(input), updateMany: m.receiptUpdate }, game: { findUnique: m.game, findFirst: m.current, updateMany: m.bind } };
  return { getPrisma: () => ({ ...db, $transaction: async (fn: (tx: typeof db) => unknown) => fn(db) }) };
});
vi.mock("../src/lib/game/service", () => ({ readGameChatState: m.state }));
vi.mock("../src/lib/game/chat-membership", () => ({ findExistingGameChat: m.discover, requireExactChat: m.exact }));
vi.mock("../src/lib/game/chat-bootstrap", () => ({ prepareGameChatBootstrap: m.bootstrap, reconcileFrozenGameChatBootstrapReceipt: m.recover }));
vi.mock("../src/lib/game/chat-delivery", () => ({ deliverGameChangeProposal: m.proposal }));
vi.mock("../src/lib/hosted-onboarding/hosted-member-identity-store", () => ({ readHostedMemberIdentity: m.identity }));
vi.mock("../src/lib/hosted-onboarding/linq-observability-identifiers", () => ({ createHostedLinqDeliveryIdempotencyLookupKey: (key: string) => `hash:${key}` }));
vi.mock("../src/lib/hosted-onboarding/linq-delivery-store", () => ({ buildHostedLinqDeliveryId: (key: string) => key }));
vi.mock("../src/lib/hosted-mailbox/store", () => ({ appendPreparedHostedMailboxEnvelopeTx: m.append, prepareHostedMailboxEnvelopeAppend: m.prepare, readHostedMailboxItemByDedupeKey: m.mailbox }));
vi.mock("../src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedMailboxAppendRuntime: m.signal }));
vi.mock("../src/lib/hosted-routing/assistant-notification-destination", () => ({
  resolveHostedAssistantNotificationDestination: m.destination,
  bindHostedAssistantNotificationDestination: () => ({ route: { channel: "linq", delivery: { kind: "thread", target: "chat" }, accountId: "line" }, externalThreadRouteAuthority: { channel: "linq", containerMemberId: "room", threadId: "chat", accountLookupKey: "line-key" } }),
  assertHostedAssistantNotificationRouteAuthority: m.route,
}));
import { deliverGameChatLifecycle, drainGameChatLifecycle } from "../src/lib/game/chat-lifecycle";
const now = new Date("2030-03-04T12:00:00Z");
const players = ["person-a", "person-b"];
const game = { id: "game", status: "live", chatContainerMemberId: "room", players: players.map((memberId) => ({ memberId })) };
const pending = { v: 1, id: "proposal", proposedByMemberId: "person-a", expectedTermsVersion: 1, change: { kind: "edit", lengthDays: 10 }, effectiveFromDay: 1, startsOn: null, origin: "app", deliveryStatus: "pending" };
const receipt = { id: "receipt", status: "awaiting_generation", sourceRef: "game", template: "game_started", attemptedAt: now, idempotencyKey: "hash:game-started:game" };

describe("durable game chat lifecycle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.receipts.mockResolvedValue([receipt]); m.frozen.mockResolvedValue([]); m.recover.mockResolvedValue(true); m.receiptUpdate.mockResolvedValue({ count: 1 });
    m.game.mockResolvedValue(game); m.current.mockResolvedValue({ id: "game" }); m.bind.mockResolvedValue({ count: 1 });
    m.state.mockResolvedValue({ games: [{ id: "game", status: "live", lengthDays: 7, startsOn: null, terms: { n: 1, fromDay: 0, tasks: [{ seat: 0, text: "Read a chapter" }, { seat: 1, text: "Read a chapter" }], schedule: { days: [0, 1, 2, 3, 4] }, stakes: [] }, players: players.map((memberId, seat) => ({ memberId, seat, firstName: seat ? "Sam" : "Alex", dayOne: "2030-03-04", timeZone: seat ? "Pacific/Auckland" : "America/Los_Angeles" })), pendingChange: null }] });
    m.identity.mockImplementation(async ({ memberId }: { memberId: string }) => ({ phoneNumber: memberId === players[0] ? "+15555550101" : "+15555550102", phoneNumberVerifiedAt: now }));
    m.discover.mockResolvedValue(null); m.bootstrap.mockResolvedValue("room"); m.proposal.mockResolvedValue(true);
    m.destination.mockResolvedValue({ conversationShape: "thread-container", route: { channel: "linq" } });
    m.mailbox.mockResolvedValue(null); m.prepare.mockResolvedValue({}); m.append.mockResolvedValue({ mailboxItemId: "notice" });
  });
  it("recovers only bounded unattached frozen receipts without model generation", async () => {
    m.receipts.mockResolvedValue([]); m.frozen.mockResolvedValue([{ id: "frozen", attemptedAt: now }]);
    await expect(drainGameChatLifecycle({ now })).resolves.toEqual({ attempted: 1, queued: 1, deferred: 0 });
    expect(m.frozen).toHaveBeenCalledExactlyOnceWith({
      where: { source: "game_lifecycle", payloadSchema: "game_chat_bootstrap_v1", bootstrapRouteAttachedAt: null, skippedAt: null, OR: [{ retryAfterAt: null }, { retryAfterAt: { lte: now } }] },
      orderBy: [{ attemptedAt: "asc" }, { id: "asc" }], take: 1, select: { id: true, attemptedAt: true },
    });
    expect(m.recover).toHaveBeenCalledExactlyOnceWith("frozen");
    expect(m.state).not.toHaveBeenCalled(); expect(m.prepare).not.toHaveBeenCalled(); expect(m.bootstrap).not.toHaveBeenCalled();
  });
  it("publishes one generated kickoff and advances the existing receipt atomically", async () => {
    await expect(drainGameChatLifecycle({ now })).resolves.toEqual({ attempted: 1, queued: 1, deferred: 0 });
    expect(m.receipts).toHaveBeenCalledWith(expect.objectContaining({ take: 1, where: expect.objectContaining({ source: "game_lifecycle" }) }));
    expect(m.receiptUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: "receipt", source: "game_lifecycle", status: "awaiting_generation", attemptedAt: now, OR: [{ retryAfterAt: null }, { retryAfterAt: { lte: now } }] },
      data: { attemptedAt: now, retryAfterAt: new Date(now.getTime() + 60_000) },
    });
    expect(m.exact).toHaveBeenCalledExactlyOnceWith("room", ["+15555550101", "+15555550102"]);
    expect(m.append).toHaveBeenCalledOnce();
    expect(m.receiptUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ where: { idempotencyKey: "hash:game-started:game", source: "game_lifecycle", status: "awaiting_generation" }, data: { status: "generation_queued", retryAfterAt: expect.any(Date) } }));
    const notification = m.prepare.mock.calls[0][0].envelope.notification;
    expect(notification.responsePolicy).toEqual({ kind: "require_send" });
    expect(notification.instructions).toContain("do not create, schedule or claim any reminders");
    expect(notification.instructions).toContain("Later questions and any reminder setup must read the current game first");
    expect(notification.instructions).toContain("0 Monday");
    const data = JSON.parse(notification.instructions.split("\n").at(-1));
    expect(data.startsOn).toBeNull();
    expect(data.players).toEqual([{ seat: 0, name: "Alex", dayOne: "2030-03-04", timeZone: "America/Los_Angeles" }, { seat: 1, name: "Sam", dayOne: "2030-03-04", timeZone: "Pacific/Auckland" }]);
  });
  it("loses a concurrent same-millisecond claim without generating or sending", async () => {
    m.receiptUpdate.mockResolvedValueOnce({ count: 0 });
    await expect(drainGameChatLifecycle({ now })).resolves.toEqual({ attempted: 0, queued: 0, deferred: 0 });
    expect(m.game).not.toHaveBeenCalled(); expect(m.bootstrap).not.toHaveBeenCalled(); expect(m.append).not.toHaveBeenCalled();
  });
  it("retains retryable intent when discovery fails before mailbox publication", async () => {
    m.game.mockResolvedValue({ ...game, chatContainerMemberId: null }); m.discover.mockRejectedValue(new Error("Provider unavailable"));
    await expect(drainGameChatLifecycle({ now })).resolves.toEqual({ attempted: 1, queued: 0, deferred: 1 });
    expect(m.receiptUpdate).toHaveBeenCalledOnce(); expect(m.append).not.toHaveBeenCalled();
  });
  it("does not publish after current source authority changed during preparation", async () => {
    m.current.mockResolvedValue(null);
    await expect(deliverGameChatLifecycle("game", "started")).resolves.toBe(false);
    expect(m.append).not.toHaveBeenCalled(); expect(m.signal).not.toHaveBeenCalled();
  });
  it("preserves queued work when the first runtime signal fails", async () => {
    m.signal.mockRejectedValue(new Error("Signal unavailable"));
    await expect(drainGameChatLifecycle({ now })).resolves.toEqual({ attempted: 1, queued: 0, deferred: 1 });
    expect(m.append).toHaveBeenCalledOnce();
    expect(m.receiptUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ data: { status: "generation_queued", retryAfterAt: expect.any(Date) } }));
    // The same bounded game receipt sweep owns notification signal recovery.
  });
  it("recovers a failed first signal without generation, route discovery or a second send", async () => {
    m.receipts.mockResolvedValue([{ ...receipt, status: "generation_queued" }]);
    m.mailbox.mockResolvedValue({ id: "queued", consumedAt: null });
    await expect(drainGameChatLifecycle({ now })).resolves.toEqual({ attempted: 1, queued: 1, deferred: 0 });
    expect(m.signal).toHaveBeenCalledExactlyOnceWith({ expectedUserId: "room", mailboxItemId: "queued" });
    expect(m.prepare).not.toHaveBeenCalled(); expect(m.discover).not.toHaveBeenCalled(); expect(m.bootstrap).not.toHaveBeenCalled();
  });
  it("hands consumed work to runtime retry ownership without rewriting provider status", async () => {
    m.receipts.mockResolvedValue([{ ...receipt, status: "generation_queued" }]);
    m.mailbox.mockResolvedValue({ id: "queued", consumedAt: now });
    await drainGameChatLifecycle({ now });
    expect(m.receiptUpdate).toHaveBeenLastCalledWith({ where: { id: "receipt", status: "generation_queued" }, data: { retryAfterAt: null } });
    expect(m.signal).not.toHaveBeenCalled(); expect(m.prepare).not.toHaveBeenCalled();
  });
  it("reuses a committed mailbox identity without a second notification", async () => {
    m.mailbox.mockResolvedValue({ id: "prior", consumedAt: null });
    await expect(deliverGameChatLifecycle("game", "started")).resolves.toBe(true);
    expect(m.append).not.toHaveBeenCalled(); expect(m.signal).toHaveBeenCalledExactlyOnceWith({ expectedUserId: "room", mailboxItemId: "prior" });
  });
  it("leaves a later kickoff retryable while an earlier frozen bootstrap owns group creation", async () => {
    m.game.mockResolvedValue({ ...game, chatContainerMemberId: null }); m.destination.mockResolvedValue(null); m.bootstrap.mockResolvedValue(null);
    await expect(drainGameChatLifecycle({ now })).resolves.toEqual({ attempted: 1, queued: 0, deferred: 1 });
    expect(m.receiptUpdate).toHaveBeenCalledOnce(); expect(m.append).not.toHaveBeenCalled();
  });
  it("uses the ordinary single proposal path for invite negotiation", async () => {
    m.receipts.mockResolvedValue([{ ...receipt, template: "game_proposal", idempotencyKey: "hash:game-change:game:proposal" }]);
    m.game.mockResolvedValue({ pendingChange: pending, status: "negotiating" });
    await expect(drainGameChatLifecycle({ now })).resolves.toEqual({ attempted: 1, queued: 1, deferred: 0 });
    expect(m.proposal).toHaveBeenCalledExactlyOnceWith("game", "proposal");
    expect(m.state).not.toHaveBeenCalled(); expect(m.bootstrap).not.toHaveBeenCalled();
  });
  it.each([null, { ...pending, id: "newer" }, { ...pending, origin: "chat", deliveryStatus: "conversation" }])("retires superseded app proposal intent without announcing it", async (pendingChange) => {
    m.receipts.mockResolvedValue([{ ...receipt, template: "game_proposal", idempotencyKey: "hash:game-change:game:proposal" }]); m.game.mockResolvedValue({ pendingChange, status: "live" });
    await drainGameChatLifecycle({ now });
    expect(m.proposal).not.toHaveBeenCalled(); expect(m.receiptUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "skipped", skipReason: "game_proposal_superseded" }) }));
  });
});
