import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  consumed: vi.fn(),
  entries: vi.fn(), reports: vi.fn(), witness: vi.fn(), groupAuthority: vi.fn(), lock: vi.fn(), wake: vi.fn(), challengeCase: vi.fn(), challengeInstructions: vi.fn(), currentChange: vi.fn(),
  event: vi.fn(), receipts: vi.fn(), frozen: vi.fn(), recover: vi.fn(), receiptUpdate: vi.fn(), game: vi.fn(), current: vi.fn(), bind: vi.fn(),
  state: vi.fn(), rematchNotice: vi.fn(), identity: vi.fn(), discover: vi.fn(), exact: vi.fn(), bootstrap: vi.fn(), proposal: vi.fn(),
  destination: vi.fn(), mailbox: vi.fn(), prepare: vi.fn(), append: vi.fn(), signal: vi.fn(), route: vi.fn(),
  reminders: vi.fn(), missedBatch: vi.fn(), reserveMissed: vi.fn(), recapMaterial: vi.fn(), recapMessages: vi.fn(), transcript: vi.fn(), room: vi.fn(),
}));
vi.mock("../src/lib/prisma", () => {
  const db = { $queryRaw: m.lock, gameEvent: { findUnique: m.event, createMany: m.witness }, gameEntry: { findMany: m.entries }, gameReport: { findMany: m.reports }, hostedThreadRoute: { findFirst: async () => ({ containerMemberId: "room" }) }, hostedLinqDelivery: { findMany: (input: { where: { payloadSchema?: string } }) => input.where.payloadSchema ? m.frozen(input) : m.receipts(input), updateMany: m.receiptUpdate }, game: { findUnique: m.game, findUniqueOrThrow: m.game, findFirst: m.current, updateMany: m.bind } };
  return { getPrisma: () => ({ ...db, $transaction: async (fn: (tx: typeof db) => unknown) => fn(db) }) };
});
vi.mock("../src/lib/game/service", () => ({ readGameChatState: m.state, readGameNoticeRoom: m.room, readGameMissedCheckInBatch: m.missedBatch, readGameRematchNotice: m.rematchNotice,
  readGameChallengeCase: m.challengeCase, readGameChallengeInstructions: m.challengeInstructions, readCurrentGameChange: m.currentChange,
  readGameRecapMaterial: m.recapMaterial, reserveDueGameMissedDayCheckIns: m.reserveMissed }));
vi.mock("../src/lib/game/chat-tool", () => ({ readGameRecapChatMessages: m.recapMessages, readGameChatTranscript: m.transcript }));
vi.mock("../src/lib/game/reminder-notification", () => ({ sendDueGameReminders: m.reminders }));
vi.mock("../src/lib/game/chat-membership", async original => ({ ...await original<typeof import("../src/lib/game/chat-membership")>(), bindPairGameChat: async (_id: string, _players: string[], candidate: string | null) => candidate, findExistingGameChat: m.discover, requireExactChat: m.exact, readGroupGameChatAuthority: m.groupAuthority, readGroupGameNoticeAuthority: m.groupAuthority }));
vi.mock("../src/lib/game/chat-bootstrap", () => ({ prepareGameChatBootstrap: m.bootstrap, reconcileFrozenGameChatBootstrapReceipt: m.recover }));
vi.mock("../src/lib/game/chat-delivery", () => ({ deliverGameChangeProposal: m.proposal, readGameProposalDeliveryPlayers: async () => ["person-a", "person-b"] }));
vi.mock("../src/lib/hosted-onboarding/hosted-member-identity-store", () => ({ readHostedMemberIdentity: m.identity }));
vi.mock("../src/lib/hosted-onboarding/linq-observability-identifiers", () => ({ createHostedLinqDeliveryIdempotencyLookupKey: (key: string) => `hash:${key}` }));
vi.mock("../src/lib/hosted-onboarding/linq-delivery-store", () => ({ buildHostedLinqDeliveryId: (key: string) => key }));
vi.mock("../src/lib/hosted-mailbox/store", () => ({ isHostedMailboxItemConsumed: m.consumed, appendPreparedHostedMailboxEnvelopeTx: m.append, prepareHostedMailboxEnvelopeAppend: m.prepare, readHostedMailboxItemByDedupeKey: m.mailbox, readHostedMailboxWakeByDedupeKey: m.wake }));
vi.mock("../src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedMailboxAppendRuntime: m.signal }));
vi.mock("../src/lib/hosted-routing/assistant-notification-destination", () => ({
  resolveHostedAssistantNotificationDestination: m.destination,
  bindHostedAssistantNotificationDestination: () => ({ route: { channel: "linq", delivery: { kind: "thread", target: "chat" }, accountId: "line" }, externalThreadRouteAuthority: { channel: "linq", containerMemberId: "room", threadId: "chat", accountLookupKey: "line-key" } }),
  assertHostedAssistantNotificationRouteAuthority: m.route,
}));
import { deliverGameChatLifecycle, drainGameChatLifecycle } from "../src/lib/game/chat-lifecycle";
import { gameGroupLoreFingerprint, gamePairLoreFingerprint } from "../src/lib/game/audience";
import { buildGameChallengeInstructions } from "../src/lib/game/challenge";
const now = new Date("2030-03-04T12:00:00Z");
const players = ["person-a", "person-b"];
const game = { id: "game", status: "live", chatContainerMemberId: "room", players: players.map((memberId) => ({ memberId })) };
const pending = { v: 1, id: "proposal", proposedByMemberId: "person-a", expectedTermsVersion: 1, change: { kind: "edit", lengthDays: 10 }, effectiveFromDay: 1, startsOn: null, origin: "app", deliveryStatus: "pending" };
const receipt = { id: "receipt", status: "awaiting_generation", sourceRef: "game", template: "game_started", attemptedAt: now, createdAt: now, payloadOwnerMemberId: "room", idempotencyKey: "hash:game-started:game" };

describe("durable game chat lifecycle", () => {
  it("shares the real deadline and abort signal with reminders and drains despite their failure", async () => {
    const controller = new AbortController();
    m.reminders.mockRejectedValueOnce(new Error("Synthetic reminder failure"));
    const start = Date.now();
    await expect(drainGameChatLifecycle({ now, signal: controller.signal })).resolves.toMatchObject({ attempted: 1 });
    expect(m.reminders).toHaveBeenCalledExactlyOnceWith(now, { signal: controller.signal, deadlineMs: expect.any(Number) });
    expect(m.reminders.mock.calls[0]![1].deadlineMs).toBeGreaterThanOrEqual(start + 90_000);
    expect(m.reserveMissed).toHaveBeenCalledExactlyOnceWith(now);
  });
  it.each([false, true])("publishes compact group facts only at the prepared revision; edited before append: %s", async edited => {
    const group = { ...game, maxPlayers: 10, audienceKey: "original", status: "invited", terms: { v: 1, versions: [{ n: edited ? 2 : 1, fromDay: 0, schedule: { count: 5 }, stakes: [] }] } };
    m.game.mockResolvedValue(group); m.current.mockResolvedValue(group); m.groupAuthority.mockResolvedValue({ memberIds: players });
    m.rematchNotice.mockResolvedValue({ maxPlayers: 10, termsVersion: 1, requester: "Alex", startsOn: null, comparison: { sameGame: true, changes: [], individualTasksChanged: false },
      terms: { defaultTask: "Walk", tasks: [{ seat: 0, text: "Walk" }], stakes: [], schedule: { count: 5 }, checkInKind: "any", lengthDays: 7 } });
    expect(await deliverGameChatLifecycle("game", "rematch")).toBe(!edited);
    const notification = m.prepare.mock.calls[0][0].envelope.notification;
    expect(notification.responsePolicy).toEqual({ kind: "require_game_rematch", gameId: "game", eventId: "game-rematch:game", termsVersion: 1 });
    expect(notification.deliveryIdempotencyKey).toBe("game-rematch:game");
    expect(m.append).toHaveBeenCalledTimes(edited ? 0 : 1);
    expect(m.lock).toHaveBeenCalledOnce();
  });

  it("does not recover a rematch edited after its immutable mailbox append", async () => {
    m.game.mockResolvedValue({ ...game, maxPlayers: 10, status: "invited", terms: { v: 1, versions: [{ n: 2, fromDay: 0, schedule: { count: 5 }, stakes: [] }] } });
    m.receipts.mockResolvedValue([{ ...receipt, status: "generation_queued", template: "game_rematch", idempotencyKey: "hash:game-rematch:game" }]);
    m.wake.mockResolvedValue({ notification: { responsePolicy: { kind: "require_game_rematch", gameId: "game", eventId: "game-rematch:game", termsVersion: 1 } } });
    await expect(drainGameChatLifecycle({ now })).resolves.toEqual({ attempted: 1, queued: 0, deferred: 1 });
    expect(m.signal).not.toHaveBeenCalled();
    expect(m.receiptUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "skipped", skipReason: "game_lifecycle_superseded" }) }));
  });
  beforeEach(() => {
    vi.resetAllMocks();
    m.consumed.mockResolvedValue(false);
    m.entries.mockResolvedValue([]); m.reports.mockResolvedValue([]); m.witness.mockResolvedValue({ count: 1 });
    m.lock.mockResolvedValue([]);
    m.reserveMissed.mockResolvedValue(0);
    m.event.mockResolvedValue({ gameId: "game", type: "change_cancelled", payload: { proposalId: "proposal" } });
    m.missedBatch.mockResolvedValue([{ gameId: "game", memberId: "person-a", missedDates: ["2030-03-03"] }, { gameId: "second-game", memberId: "person-b", missedDates: ["2030-03-03"] }]);
    m.receipts.mockResolvedValue([receipt]); m.frozen.mockResolvedValue([]); m.recover.mockResolvedValue(true); m.receiptUpdate.mockResolvedValue({ count: 1 });
    m.game.mockResolvedValue(game); m.current.mockResolvedValue({ id: "game" }); m.bind.mockResolvedValue({ count: 1 });
    m.state.mockResolvedValue({ games: [{ id: "game", status: "live", lengthDays: 7, startsOn: null, terms: { n: 1, fromDay: 0, tasks: [{ seat: 0, text: "Read a chapter" }, { seat: 1, text: "Read a chapter" }], schedule: { days: [0, 1, 2, 3, 4] }, stakes: [] }, players: players.map((memberId, seat) => ({ memberId, seat, firstName: seat ? "Sam" : "Alex", dayOne: "2030-03-04", timeZone: seat ? "Pacific/Auckland" : "America/Los_Angeles" })), pendingChange: null }] });
    m.recapMaterial.mockResolvedValue({ game: {}, players: ["Alex", "Sam"], entries: [], validation: { startedAt: now, playerNamesByMemberId: [] } });
    m.recapMessages.mockResolvedValue([{ playerName: "Alex", text: "The bounded room transcript." }]);
    m.transcript.mockResolvedValue([{ playerName: "Alex", text: "The bounded room transcript." }]);
    const rules = { checkInKind: "photo", lengthDays: 7, schedule: { days: [0, 1, 2, 3, 4] }, stakes: [], tasksByMember: { "person-a": "Read a chapter", "person-b": "Read a chapter" } };
    m.rematchNotice.mockResolvedValue({ players: [{ memberId: "person-a", name: "Alex", requester: true }, { memberId: "person-b", name: "Sam", requester: false }], previous: rules, rematch: rules, startsOn: null });
    m.identity.mockImplementation(async ({ memberId }: { memberId: string }) => ({ phoneNumber: memberId === players[0] ? "+15555550101" : "+15555550102", phoneNumberVerifiedAt: now }));
    m.discover.mockResolvedValue(null); m.bootstrap.mockResolvedValue("room"); m.proposal.mockResolvedValue(true);
    m.destination.mockResolvedValue({ conversationShape: "thread-container", route: { channel: "linq" } });
    m.mailbox.mockResolvedValue(null); m.prepare.mockResolvedValue({}); m.append.mockResolvedValue({ mailboxItemId: "notice" });
  });
  it("filters supported templates and picks one receipt per chat before the limit", async () => {
    await drainGameChatLifecycle({ now });
    const [sql, ...values] = m.lock.mock.calls[0] as [string[], ...unknown[]];
    expect(sql.join("?")).toMatch(/DISTINCT ON \(chat\)[\s\S]*source_ref IS NOT NULL[\s\S]*ORDER BY attempted_at, id LIMIT \?$/u);
    expect(values).toEqual([expect.arrayContaining(["game_started", "game_group_missed", "game_challenge"]), now, now, 10]);
  });

  it.each(["awaiting_generation", "generation_queued"])("queues or recovers one bound Prove it notice: %s", async status => {
    const eventId = "game-challenge:game:entry";
    m.receipts.mockResolvedValue([{ ...receipt, status, sourceRef: "game:entry", template: "game_challenge", idempotencyKey: `hash:${eventId}` }]);
    m.challengeCase.mockResolvedValue({ row: game, state: { players: players.map(memberId => ({ memberId })), entries: [{ id: "entry", memberId: players[1] }] },
      challenge: { actor: players[0] }, status: "open" });
    const instructions = buildGameChallengeInstructions({ challengerName: "Maya", accusedName: "Sam", dayNumber: 1, task: "Read a chapter",
      postedAt: now, timeZone: "UTC" });
    m.challengeInstructions.mockResolvedValue(instructions);
    if (status === "generation_queued") m.mailbox.mockResolvedValue({ id: "mailbox", consumedAt: null });
    await expect(drainGameChatLifecycle({ now })).resolves.toEqual({ attempted: 1, queued: 1, deferred: 0 });
    if (status === "awaiting_generation") {
      expect(m.prepare.mock.calls[0][0].envelope.notification).toMatchObject({ instructions, responsePolicy: { kind: "require_send" },
        deliveryDedupeToken: eventId, deliveryIdempotencyKey: eventId, deliveryDispatchMode: "queue-only" });
      expect(m.append).toHaveBeenCalledOnce();
    } else {
      expect(m.prepare).not.toHaveBeenCalled();
      expect(m.challengeInstructions).not.toHaveBeenCalled();
    }
    expect(m.signal).toHaveBeenCalledOnce();
    expect(m.discover).not.toHaveBeenCalled(); expect(m.bootstrap).not.toHaveBeenCalled();
  });

  it.each(["conceded", "stood", "void", "missing", "unbound"])("supersedes a queued case before generation or recovery: %s", async status => {
    for (const receiptStatus of ["awaiting_generation", "generation_queued"]) {
      m.receipts.mockResolvedValue([{ ...receipt, status: receiptStatus, sourceRef: "game:entry", template: "game_challenge", idempotencyKey: "hash:game-challenge:game:entry" }]);
      m.challengeCase.mockResolvedValue(status === "missing" ? null : { row: { ...game, chatContainerMemberId: status === "unbound" ? null : "room" },
        state: { players: players.map(memberId => ({ memberId })) }, challenge: { actor: players[0] }, status: status === "unbound" ? "open" : status });
      await expect(drainGameChatLifecycle({ now })).resolves.toEqual({ attempted: 1, queued: 0, deferred: 1 });
      expect(m.receiptUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ data: { status: "skipped", skippedAt: now,
        skipReason: "game_lifecycle_superseded", retryAfterAt: null } }));
    }
    expect(m.prepare).not.toHaveBeenCalled(); expect(m.signal).not.toHaveBeenCalled();
    expect(m.discover).not.toHaveBeenCalled(); expect(m.bootstrap).not.toHaveBeenCalled();
  });
  it("queues a rematch only in its inherited room while it is still invited", async () => {
    const rematchGame = { ...game, status: "invited", createdBy: players[0], invitees: [{ memberId: players[1] }], players: [{ memberId: players[0] }] };
    m.game.mockResolvedValue(rematchGame);
    m.receipts.mockResolvedValue([{ ...receipt, template: "game_rematch", idempotencyKey: "hash:game-rematch:game" }]);
    await expect(drainGameChatLifecycle({ now })).resolves.toEqual({ attempted: 1, queued: 1, deferred: 0 });
    const notification = m.prepare.mock.calls[0][0].envelope.notification;
    expect(notification).toMatchObject({ deliveryIdempotencyKey: "game-rematch:game", responsePolicy: { kind: "require_send" } });
    expect(notification.instructions).toContain("say yes right here or Shake on it in the Murph app, or ask for changes here or in the app");
    expect(m.rematchNotice).toHaveBeenCalledExactlyOnceWith("game", players);
    expect(m.exact).toHaveBeenCalledExactlyOnceWith("room", ["+15555550101", "+15555550102"]);
    expect(m.current).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "game", status: { in: ["invited"] }, chatContainerMemberId: "room" } }));
    expect(m.discover).not.toHaveBeenCalled(); expect(m.bootstrap).not.toHaveBeenCalled();
  });
  it.each([undefined, "synthetic_request"])("queues recap authority only for the settled game already bound to this room; regeneration=%s", async (regenerationId) => {
    const eventId = `game-recap:game${regenerationId ? `:${regenerationId}` : ""}`;
    m.game.mockResolvedValue({ ...game, status: "settled" });
    m.receipts.mockResolvedValue([{ ...receipt, template: "game_recap", sourceRef: `game${regenerationId ? `:${regenerationId}` : ""}`, idempotencyKey: `hash:${eventId}` }]);
    await expect(drainGameChatLifecycle({ now })).resolves.toEqual({ attempted: 1, queued: 1, deferred: 0 });
    const notification = m.prepare.mock.calls[0][0].envelope.notification;
    expect(notification).not.toHaveProperty("gameRecap");
    expect(notification.deliveryIdempotencyKey).toBe(eventId);
    expect(notification.responsePolicy).toEqual({ kind: "require_game_recap", gameId: "game", eventId, pairFingerprint: gamePairLoreFingerprint(players) });
    expect(notification.instructions).toContain("murph.write_recap");
    expect(notification.instructions).toContain("The bounded room transcript.");
    expect(m.discover).not.toHaveBeenCalled(); expect(m.bootstrap).not.toHaveBeenCalled();
  });
  it("queues group recaps with the original-audience key and read-only lore, failing closed without it", async () => {
    const audienceKey = "synthetic-original-audience";
    const groupGame = { ...game, maxPlayers: 10, audienceKey, status: "settled", settledAt: now,
      players: [...players.map((memberId, seat) => ({ memberId, seat, leftAt: null })), { memberId: "departed", seat: 2, leftAt: new Date(now.getTime() - 1000) }] };
    m.groupAuthority.mockResolvedValue({ keys: { current: "rotated-key", candidates: [audienceKey, "rotated-key"] } });
    m.game.mockResolvedValue(groupGame); m.current.mockResolvedValue(groupGame);
    expect(await deliverGameChatLifecycle("game", "recap")).toBe(true);
    expect(m.prepare.mock.calls[0][0].envelope.notification.responsePolicy).toEqual({ kind: "require_game_recap", gameId: "game", eventId: "game-recap:game", pairFingerprint: gameGroupLoreFingerprint(audienceKey), loreAccess: "read" });
    expect(m.prepare.mock.calls[0][0].envelope.notification.instructions).toContain("The bounded room transcript.");
    m.prepare.mockClear(); m.game.mockResolvedValue({ ...groupGame, audienceKey: null });
    expect(await deliverGameChatLifecycle("game", "recap")).toBe(false);
    expect(m.prepare).not.toHaveBeenCalled();
    expect(m.discover).not.toHaveBeenCalled(); expect(m.bootstrap).not.toHaveBeenCalled();
  });
  it("batches daily misses across tasks and players into one shared turn", async () => {
    const state = await m.state();
    state.games[0].progress = { players: [{ memberId: "person-a", days: [{ date: "2030-03-03", status: "missed" }] }] };
    state.games.push({ ...state.games[0], id: "second-game", terms: { ...state.games[0].terms, tasks: [{ seat: 0, text: "Walk" }, { seat: 1, text: "Walk" }] },
      progress: { players: [{ memberId: "person-b", days: [{ date: "2030-03-03", status: "missed" }] }] } });
    m.receipts.mockResolvedValue([{ ...receipt, template: "game_missed", sourceRef: "game:person-a:2030-03-03", idempotencyKey: "hash:game-missed:game:person-a:2030-03-03" }]);
    expect(await drainGameChatLifecycle({ now })).toEqual({ attempted: 1, queued: 1, deferred: 0 });
    expect(m.append).toHaveBeenCalledTimes(1);
    const instructions = m.prepare.mock.calls[0][0].envelope.notification.instructions;
    expect(instructions).toContain("one daily check-in");
    expect(instructions).toContain('"task":"Walk"');
    expect(instructions).toContain('"task":"Read a chapter"');
    expect(instructions).toContain('"playerName":"Sam"');
  });
  it("queues one skippable missed-day turn in the bound room", async () => {
    m.receipts.mockResolvedValue([{ ...receipt, template: "game_missed", sourceRef: "game:person-a:2030-03-03", idempotencyKey: "hash:game-missed:game:person-a:2030-03-03" }]);
    await expect(drainGameChatLifecycle({ now })).resolves.toEqual({ attempted: 1, queued: 1, deferred: 0 });
    const notification = m.prepare.mock.calls[0][0].envelope.notification;
    expect(notification).toMatchObject({ deliveryIdempotencyKey: "game-missed:game:person-a:2030-03-03",
      responsePolicy: { kind: "game_missed_check_in", gameId: "game", eventId: "game-missed:game:person-a:2030-03-03",
        memberId: "person-a", firstMissedDate: "2030-03-03", pairFingerprint: expect.stringMatching(/^[a-f0-9]{32}$/u) } });
    expect(notification.instructions).toContain("If the player already explained the miss in this chat, finish without a reply");
    expect(m.discover).not.toHaveBeenCalled(); expect(m.bootstrap).not.toHaveBeenCalled();
  });
  it("does not fabricate a single-game miss after canonical evidence disappears", async () => {
    m.receipts.mockResolvedValue([{ ...receipt, template: "game_missed", sourceRef: "game:person-a:2030-03-03", idempotencyKey: "hash:game-missed:game:person-a:2030-03-03" }]);
    m.missedBatch.mockResolvedValue([]);
    await drainGameChatLifecycle({ now });
    expect(m.prepare).not.toHaveBeenCalled();
    expect(m.receiptUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "skipped", skipReason: "game_lifecycle_superseded" }) }));
  });
  it("drops a rematch notice after acceptance and never discovers or creates a room", async () => {
    m.receipts.mockResolvedValue([{ ...receipt, template: "game_rematch", idempotencyKey: "hash:game-rematch:game" }]);
    m.game.mockResolvedValue({ ...game, status: "live" });
    await expect(drainGameChatLifecycle({ now })).resolves.toEqual({ attempted: 1, queued: 0, deferred: 1 });
    expect(m.receiptUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "skipped", skipReason: "game_lifecycle_superseded" }) }));
    expect(m.prepare).not.toHaveBeenCalled(); expect(m.discover).not.toHaveBeenCalled(); expect(m.bootstrap).not.toHaveBeenCalled();

    m.game.mockResolvedValue({ ...game, status: "invited", createdBy: players[0], invitees: [{ memberId: players[1] }], chatContainerMemberId: null, players: [{ memberId: players[0] }] });
    await expect(deliverGameChatLifecycle("game", "rematch")).resolves.toBe(false);
    expect(m.discover).not.toHaveBeenCalled(); expect(m.bootstrap).not.toHaveBeenCalled();
  });
  it.each(["awaiting_generation", "generation_queued"])("terminally skips an expired invited rematch receipt from %s", async (status) => {
    m.receipts.mockResolvedValue([{ ...receipt, template: "game_rematch", status, idempotencyKey: "hash:game-rematch:game" }]);
    m.game.mockResolvedValue({ ...game, status: "invited", inviteExpiresAt: now, createdBy: players[0], invitees: [{ memberId: players[1] }], players: [{ memberId: players[0] }] });
    await expect(drainGameChatLifecycle({ now })).resolves.toEqual({ attempted: 1, queued: 0, deferred: 1 });
    expect(m.receiptUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "skipped", skippedAt: now, retryAfterAt: null }),
    }));
    expect(m.prepare).not.toHaveBeenCalled(); expect(m.signal).not.toHaveBeenCalled();
  });
  it("lets the recovery sweep reuse the immediately queued rematch mailbox", async () => {
    const rematchGame = { ...game, status: "invited", createdBy: players[0], invitees: [{ memberId: players[1] }], players: [{ memberId: players[0] }] };
    m.game.mockResolvedValue(rematchGame);
    await expect(deliverGameChatLifecycle("game", "rematch")).resolves.toBe(true);
    expect(m.append).toHaveBeenCalledOnce();
    m.mailbox.mockResolvedValue({ id: "rematch-notice", consumedAt: null });
    m.receipts.mockResolvedValue([{ ...receipt, template: "game_rematch", status: "generation_queued", idempotencyKey: "hash:game-rematch:game" }]);
    await expect(drainGameChatLifecycle({ now })).resolves.toEqual({ attempted: 1, queued: 1, deferred: 0 });
    expect(m.append).toHaveBeenCalledOnce();
    expect(m.signal).toHaveBeenLastCalledWith({ expectedUserId: "room", mailboxItemId: "rematch-notice" });
  });
  it.each(["The proposed start date has passed. Propose a new date.", "The proposed game length ends on a day already started. Propose a longer game."])("queues one existing-room refusal with the immutable reason: %s", async (reason) => {
    m.event.mockResolvedValue({ gameId: "game", type:"change_expired", payload:{proposalId: "proposal", reason} });
    m.receipts.mockResolvedValue([{...receipt, template:"game_change_expired", sourceRef:"game:proposal"}]);
    await expect(drainGameChatLifecycle({now})).resolves.toEqual({attempted:1,queued:1,deferred:0});
    const notification = m.prepare.mock.calls[0][0].envelope.notification;
    expect(notification.instructions).toContain(reason);
    expect(notification.instructions).toContain("one brief, plain line");
    expect(notification.deliveryIdempotencyKey).toBe("game-change-expired:game:proposal");
    expect(notification.responsePolicy).toEqual({kind:"require_send"});
    expect(m.append).toHaveBeenCalledOnce();
    expect(m.state).not.toHaveBeenCalled(); expect(m.discover).not.toHaveBeenCalled(); expect(m.bootstrap).not.toHaveBeenCalled();
    m.mailbox.mockResolvedValue({id:"refusal",consumedAt:null});
    m.receipts.mockResolvedValue([{...receipt, template:"game_change_expired", sourceRef:"game:proposal",status:"generation_queued"}]);
    await drainGameChatLifecycle({now});
    expect(m.append).toHaveBeenCalledOnce();
    expect(m.signal).toHaveBeenLastCalledWith({expectedUserId:"room",mailboxItemId:"refusal"});
  });
  it("does not bootstrap a refusal or publish it without recorded refusal evidence", async () => {
    m.game.mockResolvedValue({...game,chatContainerMemberId:null});
    expect(await deliverGameChatLifecycle("game","change_expired","proposal")).toBe(false);
    m.game.mockResolvedValue(game); m.event.mockResolvedValue({type:"change_expired",payload:{proposalId:"proposal"}});
    expect(await deliverGameChatLifecycle("game","change_expired","proposal")).toBe(false);
    expect(m.prepare).not.toHaveBeenCalled(); expect(m.discover).not.toHaveBeenCalled(); expect(m.bootstrap).not.toHaveBeenCalled();
  });
  it("announces a cancelled invite only in its existing chat without reading private game words", async () => {
    m.game.mockResolvedValue({ ...game, status: "void" });
    m.receipts.mockResolvedValue([{ ...receipt, template: "game_cancelled" }]);
    await expect(drainGameChatLifecycle({ now })).resolves.toEqual({ attempted: 1, queued: 1, deferred: 0 });
    const notification = m.prepare.mock.calls[0][0].envelope.notification;
    expect(notification.instructions).toContain("earlier game invite");
    expect(notification.instructions).toContain("one brief, plain line");
    expect(notification.deliveryIdempotencyKey).toBe("game-cancelled:game");
    expect(m.exact).toHaveBeenCalledExactlyOnceWith("room", ["+15555550101", "+15555550102"]);
    expect(m.current).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "game", status: { in: ["void"] }, chatContainerMemberId: "room" } }));
    expect(m.state).not.toHaveBeenCalled(); expect(m.discover).not.toHaveBeenCalled(); expect(m.bootstrap).not.toHaveBeenCalled();
    expect(m.append).toHaveBeenCalledOnce();
  });
  it("recovers a cancelled invite wake without a second notice", async () => {
    m.game.mockResolvedValue({ ...game, status: "void" });
    m.receipts.mockResolvedValue([{ ...receipt, template: "game_cancelled", status: "generation_queued" }]);
    m.mailbox.mockResolvedValue({ id: "cancel-notice", consumedAt: null });
    await expect(drainGameChatLifecycle({ now })).resolves.toEqual({ attempted: 1, queued: 1, deferred: 0 });
    expect(m.mailbox).toHaveBeenCalledWith(expect.objectContaining({ dedupeKey: "game-cancelled:game" }));
    expect(m.signal).toHaveBeenCalledExactlyOnceWith({ expectedUserId: "room", mailboxItemId: "cancel-notice" });
    expect(m.prepare).not.toHaveBeenCalled(); expect(m.bootstrap).not.toHaveBeenCalled();
  });
  it("does not create or discover a chat for a cancelled invite", async () => {
    m.game.mockResolvedValue({ ...game, status: "void", chatContainerMemberId: null });
    await expect(deliverGameChatLifecycle("game", "cancelled")).resolves.toBe(false);
    expect(m.discover).not.toHaveBeenCalled(); expect(m.bootstrap).not.toHaveBeenCalled(); expect(m.prepare).not.toHaveBeenCalled();
    m.game.mockResolvedValue({ ...game, status: "void" }); m.destination.mockResolvedValue(null);
    await expect(deliverGameChatLifecycle("game", "cancelled")).resolves.toBe(false);
    expect(m.bootstrap).not.toHaveBeenCalled();
  });
  it("keeps exact-chat and current game authority on cancellation notices", async () => {
    m.game.mockResolvedValue({ ...game, status: "void" }); m.current.mockResolvedValue(null);
    await expect(deliverGameChatLifecycle("game", "cancelled")).resolves.toBe(false);
    expect(m.append).not.toHaveBeenCalled();
    m.exact.mockRejectedValue(new Error("Changed roster"));
    await expect(deliverGameChatLifecycle("game", "cancelled")).rejects.toThrow("Changed roster");
    expect(m.append).not.toHaveBeenCalled();
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
  it("introduces a second game in a shared room by its tasks without repeating the reminder offer", async () => {
    const room = { tasks: ["Read a chapter", "Read a chapter"], otherGames: [{ status: "live", tasks: ["50 pushups", "30 minute walk"] }], startedAfterAnother: true };
    m.room.mockResolvedValue(room);
    await expect(drainGameChatLifecycle({ now })).resolves.toEqual({ attempted: 1, queued: 1, deferred: 0 });
    expect(m.room).toHaveBeenCalledExactlyOnceWith("game", players);
    const { instructions } = m.prepare.mock.calls[0][0].envelope.notification;
    expect(instructions).toContain("Skip the reminder offer");
    expect(instructions).not.toContain("Briefly offer reminders");
    expect(JSON.parse(instructions.split("\n").at(-1))).toEqual({ thisGameTasks: room.tasks, otherGames: room.otherGames });
  });
  it("recovers one frozen bootstrap per pass, and none once the claim budget is spent", async () => {
    m.receipts.mockResolvedValue([]);
    m.frozen.mockResolvedValue([{ id: "frozen", attemptedAt: now }]);
    m.recover.mockResolvedValue(true);
    await expect(drainGameChatLifecycle({ now })).resolves.toEqual({ attempted: 1, queued: 1, deferred: 0 });
    expect(m.frozen).toHaveBeenCalledWith(expect.objectContaining({ take: 1 }));
    m.recover.mockClear();
    const clock = vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(90_000);
    await expect(drainGameChatLifecycle({ now })).resolves.toEqual({ attempted: 0, queued: 0, deferred: 0 });
    expect(m.recover).not.toHaveBeenCalled();
    clock.mockRestore();
  });

  it.each(["pending", "frozen"] as const)("leases a %s claim from the moment it was claimed, not from the start of the drain", async kind => {
    m.receipts.mockResolvedValue(kind === "pending" ? [receipt] : []);
    m.frozen.mockResolvedValue(kind === "frozen" ? [{ id: "frozen", attemptedAt: now }] : []);
    const clock = vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(65_000);
    await drainGameChatLifecycle({ now });
    clock.mockRestore();
    expect(m.receiptUpdate.mock.calls[0]![0].data).toEqual({ attemptedAt: now, retryAfterAt: new Date(now.getTime() + 65_000 + 180_000) });
  });

  it("logs a failed frozen recovery with its fixed code", async () => {
    m.receipts.mockResolvedValue([]);
    m.frozen.mockResolvedValue([{ id: "frozen", attemptedAt: now }]);
    m.recover.mockRejectedValue(new TypeError("Synthetic detail about room-secret."));
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(drainGameChatLifecycle({ now })).resolves.toEqual({ attempted: 1, queued: 0, deferred: 1 });
    expect(info).toHaveBeenCalledWith(expect.any(String), { diagnostic: "game.chat-lifecycle-item", kind: "item_failed", template: "game_chat_bootstrap", reason: "TypeError" });
    expect(JSON.stringify(info.mock.calls)).not.toContain("room-secret");
    info.mockRestore();
  });

  it("surfaces a failed claim only after its sibling worker has finished", async () => {
    let finishSibling = () => {};
    const sibling = new Promise<null>(resolve => { finishSibling = () => resolve(null); });
    m.receipts.mockResolvedValue([{ ...receipt, id: "first", sourceRef: "game-a" }, { ...receipt, id: "second", sourceRef: "game-b" }]);
    m.receiptUpdate.mockReset();
    m.receiptUpdate.mockRejectedValueOnce(new Error("Synthetic claim failure.")).mockResolvedValue({ count: 1 });
    m.game.mockImplementationOnce(() => sibling);
    let settled = false;
    const draining = drainGameChatLifecycle({ now }).finally(() => { settled = true; });
    draining.catch(() => {});
    await vi.waitFor(() => expect(m.game).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    finishSibling();
    await expect(draining).rejects.toThrow("Synthetic claim failure.");
  });

  it("publishes one generated kickoff and advances the existing receipt atomically", async () => {
    await expect(drainGameChatLifecycle({ now })).resolves.toEqual({ attempted: 1, queued: 1, deferred: 0 });
    expect(m.receiptUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: "receipt", source: "game_lifecycle", status: "awaiting_generation", attemptedAt: now, OR: [{ retryAfterAt: null }, { retryAfterAt: { lte: now } }] },
      data: { attemptedAt: now, retryAfterAt: expect.any(Date) },
    });
    expect(m.exact).toHaveBeenCalledExactlyOnceWith("room", ["+15555550101", "+15555550102"]);
    expect(m.append).toHaveBeenCalledOnce();
    expect(m.receiptUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ where: { idempotencyKey: "hash:game-started:game", source: "game_lifecycle", status: "awaiting_generation" }, data: { status: "generation_queued", retryAfterAt: expect.any(Date), payloadOwnerMemberId: "room" } }));
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
    expect(m.receiptUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ data: { status: "generation_queued", retryAfterAt: expect.any(Date), payloadOwnerMemberId: "room" } }));
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
    m.mailbox.mockResolvedValue({ id: "queued", consumedAt: null });
    m.consumed.mockResolvedValue(true);
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
    expect(m.proposal).toHaveBeenCalledExactlyOnceWith("game", "proposal", now);
    expect(m.state).not.toHaveBeenCalled(); expect(m.bootstrap).not.toHaveBeenCalled();
  });
  it("does not regenerate an immediately queued negotiation proposal when the sweep follows", async () => {
    m.receipts.mockResolvedValue([{ ...receipt, template: "game_proposal", status: "generation_queued", idempotencyKey: "hash:game-change:game:proposal" }]);
    m.game.mockResolvedValue({ ...game, pendingChange: pending, status: "negotiating" });
    m.mailbox.mockResolvedValue({ id: "proposal-notice", consumedAt: null });
    await expect(drainGameChatLifecycle({ now })).resolves.toEqual({ attempted: 1, queued: 1, deferred: 0 });
    expect(m.proposal).not.toHaveBeenCalled();
    expect(m.prepare).not.toHaveBeenCalled(); expect(m.append).not.toHaveBeenCalled();
    expect(m.signal).toHaveBeenCalledExactlyOnceWith({ expectedUserId: "room", mailboxItemId: "proposal-notice" });
  });
  it.each(["awaiting_generation", "generation_queued"])("terminally skips an expired negotiating proposal receipt from %s", async (status) => {
    m.receipts.mockResolvedValue([{ ...receipt, template: "game_proposal", status, idempotencyKey: "hash:game-change:game:proposal" }]);
    m.game.mockResolvedValue({ ...game, inviteExpiresAt: now, pendingChange: pending, status: "negotiating" });
    await expect(drainGameChatLifecycle({ now })).resolves.toEqual({ attempted: 1, queued: 0, deferred: 1 });
    expect(m.receiptUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "skipped", skippedAt: now, skipReason: "game_proposal_superseded" }),
    }));
    expect(m.proposal).not.toHaveBeenCalled(); expect(m.signal).not.toHaveBeenCalled();
  });
  it.each([null, { ...pending, id: "newer" }, { ...pending, origin: "chat", deliveryStatus: "conversation" }])("retires superseded app proposal intent without announcing it", async (pendingChange) => {
    m.receipts.mockResolvedValue([{ ...receipt, template: "game_proposal", idempotencyKey: "hash:game-change:game:proposal" }]); m.game.mockResolvedValue({ pendingChange, status: "live" });
    await drainGameChatLifecycle({ now });
    expect(m.proposal).not.toHaveBeenCalled(); expect(m.receiptUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "skipped", skipReason: "game_proposal_superseded" }) }));
  });
  it.each(["awaiting_generation", "generation_queued"])("checks canonical group eligibility before proposal %s", async (status) => {
    m.receipts.mockResolvedValue([{ ...receipt, template: "game_proposal", status, idempotencyKey: "hash:game-change:game:proposal" }]);
    m.game.mockResolvedValue({ ...game, maxPlayers: 10, pendingChange: pending });
    m.currentChange.mockResolvedValue(null);
    await drainGameChatLifecycle({ now });
    expect(m.currentChange).toHaveBeenCalledWith(expect.anything(), "game", "proposal", now);
    expect(m.receiptUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "skipped" }) }));
    expect(m.proposal).not.toHaveBeenCalled(); expect(m.signal).not.toHaveBeenCalled();
  });
  it.each(["live", "negotiating"])("announces cancellation once for a %s game through the existing lifecycle", async (status) => {
    m.receipts.mockResolvedValue([{ ...receipt, sourceRef: "game:proposal", template: "game_change_cancelled", idempotencyKey: "hash:game-change-cancelled:game:proposal" }]);
    m.game.mockResolvedValue({ ...game, status });
    const state = await m.state();
    m.state.mockResolvedValue({ games: [{ ...state.games[0], status }] });
    await expect(drainGameChatLifecycle({ now })).resolves.toEqual({ attempted: 1, queued: 1, deferred: 0 });
    expect(m.exact).toHaveBeenCalledExactlyOnceWith("room", ["+15555550101", "+15555550102"]);
    expect(m.append).toHaveBeenCalledOnce();
    expect(m.prepare.mock.calls[0][0].envelope.notification).toMatchObject({
      deliveryIdempotencyKey: "game-change-cancelled:game:proposal", responsePolicy: { kind: "require_send" },
      instructions: expect.stringContaining("did not alter the game"),
    });
    expect(m.current).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "game", status: { in: ["live", "negotiating"] }, chatContainerMemberId: "room" } }));
    expect(m.receiptUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ where: { idempotencyKey: "hash:game-change-cancelled:game:proposal", source: "game_lifecycle", status: "awaiting_generation" } }));
  });
  it("recovers the same cancellation mailbox after the first signal fails", async () => {
    m.receipts.mockResolvedValue([{ ...receipt, status: "generation_queued", sourceRef: "game:proposal", template: "game_change_cancelled" }]);
    m.game.mockResolvedValue({ ...game, status: "negotiating" });
    m.mailbox.mockResolvedValue({ id: "cancel-notice", consumedAt: null });
    await expect(drainGameChatLifecycle({ now })).resolves.toEqual({ attempted: 1, queued: 1, deferred: 0 });
    expect(m.mailbox).toHaveBeenCalledWith(expect.objectContaining({ dedupeKey: "game-change-cancelled:game:proposal", userId: "room" }));
    expect(m.signal).toHaveBeenCalledExactlyOnceWith({ expectedUserId: "room", mailboxItemId: "cancel-notice" });
    expect(m.prepare).not.toHaveBeenCalled();
  });

});
