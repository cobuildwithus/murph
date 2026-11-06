import { createHostedPhoneLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import { linqRoster } from "./helpers/linq-roster";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "@/src/lib/prisma";
import { readGame, readHome, readInvitePreview, runGameCommand } from "@/src/lib/game/service";
import { deliverGameChatLifecycle, drainGameChatLifecycle } from "@/src/lib/game/chat-lifecycle";
import { deliverGameChangeProposal, readGameProposalDeliveryPlayers } from "@/src/lib/game/chat-delivery";
import { assertGameProposalDeliveryCurrentTx } from "@/src/lib/game/chat-delivery-authority";
import { handleGameChatBootstrapControl, prepareGameChatBootstrap } from "@/src/lib/game/chat-bootstrap";
import { prepareGameAccountDeletion, applyGameAccountDeletionTx } from "@/src/lib/game/account-deletion";
import { readHostedMailboxWakeByDedupeKey } from "@/src/lib/hosted-mailbox/store";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import * as crypto from "@/src/lib/game/crypto";
import { readGameTalkReceiptIdentity } from "@/src/lib/game/talk";

const m = vi.hoisted(() => ({ create: vi.fn(), signal: vi.fn(), lineKey: "", first: "", phones: true, expanded: false }));
vi.mock("@/src/lib/hosted-crypto/domain-root-store", async (original) => ({ ...await original<typeof import("@/src/lib/hosted-crypto/domain-root-store")>(),
  prepareHostedCryptoDomainRootCandidates: async () => new Map(),
  prewarmPreparedHostedCryptoDomainRootForWeb: async () => {},
  provisionPreparedHostedCryptoDomainRootsTx: async () => {},
  unwrapHostedDomainRootForWeb: async () => ({ rootKey: new Uint8Array(32), envelope: { rootKeyId: "synthetic-control-root" } }),
}));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedMailboxAppendRuntime: m.signal }));
vi.mock("@/src/lib/hosted-execution/runtime-owner", async (original) => ({ ...await original<typeof import("@/src/lib/hosted-execution/runtime-owner")>(), requireHostedRuntimeCallbackTx: vi.fn() }));
vi.mock("@/src/lib/hosted-mailbox/runtime-access", async (original) => ({ ...await original<typeof import("@/src/lib/hosted-mailbox/runtime-access")>(), requireHostedRuntimeActiveAccessForUpdateTx: vi.fn() }));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({ readHostedMemberIdentity: async ({ memberId }: { memberId: string }) => ({ phoneNumber: memberId === m.first ? "+15555550101" : "+15555550102", phoneNumberVerifiedAt: m.phones ? new Date() : null }) }));
vi.mock("@/src/lib/hosted-onboarding/linq-line-store", async (original) => ({ ...await original<typeof import("@/src/lib/hosted-onboarding/linq-line-store")>(),
  listHostedLinqHealthyProactiveLines: async () => [{ phoneNumber: "+15555550100", phoneNumberLookupKey: m.lineKey, maxNewConversationsPerDay: 10 }],
  claimHostedLinqProactiveConversationCapacityTx: async () => true,
  readHostedLinqIncomingLineState: async () => ({ kind: "assignable", phoneNumberLookupKey: m.lineKey }),
}));
vi.mock("@/src/lib/hosted-onboarding/linq-client", async (original) => ({ ...await original<typeof import("@/src/lib/hosted-onboarding/linq-client")>(),
  createHostedLinqChat: m.create,
  getHostedLinqChatSummary: async () => linqRoster({ isGroup: true, handlesComplete: true, handles: [
    { handle: "+15555550100", isMe: true, status: "active" },
    { handle: "+15555550101", isMe: false, status: "active" },
    { handle: "+15555550102", isMe: false, status: "active" },
    ...(m.expanded ? [{ handle: "+15555550103", isMe: false, status: "active" }] : []),
  ] }),
}));
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Talk proof requires an isolated local test database.");
const members: string[] = [], games: string[] = [], lines: string[] = [];
const run = (actorMemberId: string, command: unknown) => runGameCommand({ actorMemberId, command });
const key = (eventId: string) => createHostedLinqDeliveryIdempotencyLookupKey(eventId)!;
const note = "I don't drink coffee. Could we decide on a different prize together?";
async function fixture(existingRoom = false) {
  const db = getPrisma(), first = randomUUID(), second = randomUUID(), room: string = randomUUID(), gameId = randomUUID();
  m.first = first; m.lineKey = `synthetic-line-${randomUUID()}`;
  members.push(first, second, ...(existingRoom ? [room] : [])); games.push(gameId); lines.push(m.lineKey);
  await db.hostedMember.createMany({ data: [first, second, ...(existingRoom ? [room] : [])].map(id => ({ id, billingStatus: "not_started" })) });
  await db.hostedMemberIdentity.createMany({ data: [first, second].map((memberId, index) => ({ memberId, phoneLookupKey: createHostedPhoneLookupKey(index === 0 ? "+15555550101" : "+15555550102") })) });
  await db.hostedLinqLine.create({ data: { phoneNumberLookupKey: m.lineKey, phoneNumberHint: "0100", healthStatus: "healthy" } });
  if (existingRoom) await db.hostedThreadContainer.create({ data: { memberId: room, ownerMemberId: first,
    participants: { create: [first, second].map(participantMemberId => ({ participantMemberId, handleLookupKey: participantMemberId, firstSeenAt: new Date(), lastSeenAt: new Date() })) } } });
  for (const [actor, firstName] of [[first, "Ava"], [second, "Sam"]]) expect(await run(actor, { type: "setProfile", firstName, timeZone: "UTC" })).toMatchObject({ ok: true });
  const created = await run(first, { type: "createGame", gameId, inviteeFirstName: "Sam", terms: {
    tasks: [{ seat: 0, text: "Read" }, { seat: 1, text: "Walk" }], schedule: { count: 3 }, stakes: [{ kind: "prize", item: "Coffee delivery" }], lengthDays: 7,
  } });
  if (!created.ok || !created.game?.inviteToken) throw new Error("Expected synthetic invite.");
  if (existingRoom) await db.game.update({ where: { id: gameId }, data: { chatContainerMemberId: room } });
  const proposalId = randomUUID(), eventId = `game-talk:${gameId}:${proposalId}`, token = created.game.inviteToken;
  const command = { type: "negotiate", token, proposalId, termsVersion: 1, timeZone: "UTC", note };
  return { db, first, second, room, gameId, proposalId, eventId, token, command };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function talk(f: Fixture) {
  const result = await run(f.second, f.command);
  const row = await f.db.game.findUniqueOrThrow({ where: { id: f.gameId } });
  if (row.chatContainerMemberId && row.chatContainerMemberId !== f.room) {
    f.room = row.chatContainerMemberId;
    members.push(f.room);
  }
  return result;
}

const receipt = (f: Fixture) => f.db.hostedLinqDelivery.findUniqueOrThrow({ where: { idempotencyKey: key(f.eventId) } });
const control = (f: Fixture, text?: string) => handleGameChatBootstrapControl({ memberId: f.room, runtimeIdentity: null,
  request: { action: "game_chat_bootstrap", gameId: f.gameId, eventId: f.eventId,
    ...(text === undefined ? { operation: "recover" } : { operation: "send", text }) } });
async function sweep(f: Fixture) {
  await f.db.hostedLinqDelivery.updateMany({ where: { idempotencyKey: key(f.eventId), status: { in: ["awaiting_generation", "generation_queued"] } }, data: { attemptedAt: new Date("1900-01-01"), retryAfterAt: new Date(0) } });
  return drainGameChatLifecycle({ prisma: f.db });
}
async function attachRoom(f: Fixture) {
  const { prepareHostedThreadContainerDeliveryRoute, attachHostedThreadContainerBootstrapRouteTx } = await import("@/src/lib/hosted-routing/thread-container-service");
  const prepared = await prepareHostedThreadContainerDeliveryRoute({ containerMemberId: f.room, prisma: f.db,
    channel: "linq", accountLookupKey: m.lineKey, threadId: `chat-${f.room}`, observedDeliveryRouteEncrypted: null });
  await f.db.$transaction(tx => attachHostedThreadContainerBootstrapRouteTx({ gameId: f.gameId, prepared, prisma: tx }));
}

describe.skipIf(!enabled)("talk it over PostgreSQL", () => {
  beforeEach(() => {
    m.create.mockReset().mockResolvedValue({ chatId: `synthetic-chat-${randomUUID()}`, messageId: `synthetic-message-${randomUUID()}` });
    m.signal.mockReset().mockResolvedValue(undefined); m.phones = true; m.expanded = false;
  });
  afterEach(async () => {
    const db = getPrisma();
    await db.hostedLinqDelivery.deleteMany({ where: { OR: [{ sourceRef: { in: games } }, { payloadOwnerMemberId: { in: members } }] } });
    await db.game.deleteMany({ where: { id: { in: games } } });
    await db.hostedThreadContainer.deleteMany({ where: { memberId: { in: members } } });
    await db.hostedGroup.deleteMany({ where: { ownerMemberId: { in: members } } });
    await db.hostedMember.deleteMany({ where: { id: { in: members } } });
    await db.hostedLinqLine.deleteMany({ where: { phoneNumberLookupKey: { in: lines } } });
    await db.hostedGroupParticipantObservation.deleteMany({ where: { contactLookupKey: { in: ["+15555550101", "+15555550102", "+15555550103"].map(phone => createHostedPhoneLookupKey(phone)!) } } });
    members.length = 0; games.length = 0; lines.length = 0;
  });
  it("claims without accepting, seals the author-bound note and replays one effect", async () => {
    const f = await fixture(); m.phones = false;
    const seal = vi.spyOn(crypto, "sealGameText");
    expect(await readInvitePreview(f.token)).toMatchObject({ status: "open", supportsTalk: true });
    expect(await talk(f)).toMatchObject({ ok: true, game: { status: "negotiating", pendingChange: null, startedAt: null, days: [], talkDelivery: "pending" } });
    expect(seal).toHaveBeenCalledWith({ memberId: f.second, table: "game", rowId: f.gameId, field: `talk_note:${f.proposalId}` }, note);
    const events = await f.db.gameEvent.findMany({ where: { gameId: f.gameId, type: "talk_requested" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor: f.second, commandKey: `game-change:${f.gameId}:${f.proposalId}`, payload: { v: 1, proposalId: f.proposalId, noteEncrypted: expect.any(String) } });
    expect(JSON.stringify(events.map(event => event.payload))).not.toContain(note);
    expect(await crypto.openGameTexts([{ memberId: f.second, table: "game", rowId: f.gameId, field: `talk_note:${f.proposalId}`, value: (events[0].payload as { noteEncrypted: string }).noteEncrypted }])).toEqual([note]);
    expect(await talk(f)).toMatchObject({ ok: true, game: { status: "negotiating" } });
    expect(await run(f.first, f.command)).toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });
    expect(await run(f.second, { ...f.command, proposalId: randomUUID() })).toMatchObject({ ok: false, error: { code: "INVITE_USED" } });
    expect(await f.db.gamePlayer.findMany({ where: { gameId: f.gameId }, select: { dayOne: true } })).toEqual([{ dayOne: null }, { dayOne: null }]);
    expect(await f.db.gameEvent.count({ where: { gameId: f.gameId, type: "talk_requested" } })).toBe(1);
    expect(await f.db.gameEvent.count({ where: { gameId: f.gameId, type: "negotiation_joined" } })).toBe(1);
    expect(await f.db.hostedLinqDelivery.findMany({ where: { sourceRef: f.gameId }, select: { template: true, status: true } })).toEqual([{ template: "game_talk", status: "awaiting_generation" }]);
    expect(await readGameTalkReceiptIdentity(f.db, await receipt(f))).toEqual({ gameId: f.gameId, proposalId: f.proposalId, eventId: f.eventId });
    expect(await readGameTalkReceiptIdentity(f.db, { ...await receipt(f), idempotencyKey: key(`game-talk:${f.gameId}:${randomUUID()}`) })).toBeNull();
    expect(await readGame(f.gameId, f.first)).not.toHaveProperty("talkDelivery");
    expect((await readHome(f.second)).games[0].talkDelivery).toBe("pending");
    for (const [status, expected] of [["accepted", "sent"], ["delivered", "sent"], ["failed", "failed"], ["skipped", "failed"]]) {
      await f.db.hostedLinqDelivery.update({ where: { idempotencyKey: key(f.eventId) }, data: { status } });
      expect((await readGame(f.gameId, f.second))?.talkDelivery).toBe(expected);
    }
  });
  it("lets the invitee Shake on it after talking without changing the rules", async () => {
    const f = await fixture(); m.phones = false;
    await talk(f);
    expect(await run(f.second, { type: "join", token: f.token, termsVersion: 1, timeZone: "UTC" })).toMatchObject({ ok: true, game: { status: "live", pendingChange: null, terms: { n: 1 }, lengthDays: 7 } });
    expect(await deliverGameChatLifecycle(f.gameId, "talk", f.proposalId)).toBe(false);
    expect(await f.db.gameEvent.count({ where: { gameId: f.gameId, type: "started" } })).toBe(1);
  });
  it.each([false, true])("keeps talk first and delivers the later proposal once, another game: %s", async anotherGame => {
    const f = await fixture();
    expect(await talk(f)).toMatchObject({ ok: true });
    const wake = await readHostedMailboxWakeByDedupeKey({ userId: f.room, dedupeKey: f.eventId, prisma: f.db });
    expect(wake).toMatchObject({ notification: { gameChatBootstrap: { gameId: f.gameId, eventId: f.eventId }, instructions: expect.stringContaining(note) } });
    expect(await receipt(f)).toMatchObject({ status: "generation_queued", sourceRef: f.gameId, template: "game_talk" });
    const proposalId = randomUUID(), proposalGameId = anotherGame ? randomUUID() : f.gameId;
    const change = { kind: "edit", stakes: [{ kind: "prize", item: "Choose a film" }] };
    if (anotherGame) {
      games.push(proposalGameId);
      const created = await run(f.first, { type: "createGame", gameId: proposalGameId, inviteeFirstName: "Sam", terms: {
        tasks: [{ seat: 0, text: "Swim" }, { seat: 1, text: "Stretch" }], schedule: { count: 3 }, stakes: [{ kind: "prize", item: "Tea" }], lengthDays: 7,
      } });
      if (!created.ok || !created.game?.inviteToken) throw new Error("Expected second invite.");
      expect(await run(f.second, { type: "negotiate", token: created.game.inviteToken, proposalId, termsVersion: 1, timeZone: "UTC", change })).toMatchObject({ ok: true });
    } else {
      expect(await run(f.second, { type: "proposeChange", gameId: proposalGameId, proposalId, expectedTermsVersion: 1, change })).toMatchObject({ ok: true });
      expect(await talk(f)).toMatchObject({ ok: true, game: { pendingChange: { id: proposalId } } });
    }
    expect(await prepareGameChatBootstrap(proposalGameId, `game-change:${proposalGameId}:${proposalId}`, "Ask about the new prize.")).toBeNull();
    expect(await f.db.hostedMailboxItem.count({ where: { userId: f.room, kind: "assistant.notification.requested" } })).toBe(1);
    expect(await control(f)).toMatchObject({ result: { status: "needs_message" } });
    const text = "Sam wants to talk about the coffee prize before agreeing. Ava, what do you think?";
    expect(await control(f, text)).toMatchObject({ result: { status: "sent" } });
    expect(m.create).toHaveBeenCalledOnce();
    expect(m.create.mock.calls[0][0]).toMatchObject({ message: text });
    expect(await deliverGameChangeProposal(proposalGameId, proposalId)).toBe(true);
    expect(await deliverGameChangeProposal(proposalGameId, proposalId)).toBe(true);
    const later = await readHostedMailboxWakeByDedupeKey({ userId: f.room, dedupeKey: `game-change:${proposalGameId}:${proposalId}`, prisma: f.db });
    expect(later).toMatchObject({ notification: { deliveryDispatchMode: "queue-only" } });
    if (later?.kind === "assistant.notification.requested") expect(later.notification.gameChatBootstrap).toBeUndefined();
    expect(await f.db.hostedMailboxItem.count({ where: { userId: f.room, kind: "assistant.notification.requested" } })).toBe(2);
    expect(await f.db.hostedThreadRoute.count({ where: { containerMemberId: f.room } })).toBe(1);
    expect((await readGame(f.gameId, f.second))?.talkDelivery).toBe("sent");
  });
  it("enqueues an existing-room talk and validates its fresh egress audience", async () => {
    const f = await fixture(true); await attachRoom(f);
    expect(await talk(f)).toMatchObject({ ok: true });
    const wake = await readHostedMailboxWakeByDedupeKey({ userId: f.room, dedupeKey: f.eventId, prisma: f.db });
    expect(wake).toMatchObject({ notification: { deliveryDispatchMode: "queue-only", responsePolicy: { kind: "require_send" } } });
    if (wake?.kind === "assistant.notification.requested") expect(wake.notification.gameChatBootstrap).toBeUndefined();
    const players = await readGameProposalDeliveryPlayers(f.eventId, f.room);
    expect(players).toEqual(expect.arrayContaining([f.first, f.second]));
    expect(await f.db.$transaction(tx => assertGameProposalDeliveryCurrentTx({ deliveryIdempotencyKey: f.eventId, containerMemberId: f.room, playerMemberIds: [f.first, f.second], tx }))).toBe(true);
    m.expanded = true;
    await expect(readGameProposalDeliveryPlayers(f.eventId, f.room)).rejects.toThrow("participants have changed");
    expect(m.create).not.toHaveBeenCalled();
  });
  it("recovers empty reservations and failed signals without duplicate publication", async () => {
    const f = await fixture(); m.phones = false;
    expect(await talk(f)).toMatchObject({ ok: true });
    expect(await receipt(f)).toMatchObject({ status: "awaiting_generation" });
    m.phones = true; m.signal.mockRejectedValueOnce(new Error("Synthetic signal outage"));
    await sweep(f);
    const queuedGame = await f.db.game.findUniqueOrThrow({ where: { id: f.gameId } });
    f.room = queuedGame.chatContainerMemberId!; members.push(f.room);
    expect(await receipt(f)).toMatchObject({ status: "generation_queued" });
    m.signal.mockClear();
    expect(await sweep(f)).toMatchObject({ queued: 1 });
    expect(m.signal).toHaveBeenCalledOnce();
    expect(await f.db.hostedMailboxItem.count({ where: { userId: f.room, dedupeKey: f.eventId } })).toBe(1);
  });
  it.each(["cancel", "expiry", "block"])("makes talk stale after %s", async reason => {
    const f = await fixture(); await talk(f);
    if (reason === "cancel") await run(f.first, { type: "cancelInvite", gameId: f.gameId });
    else if (reason === "expiry") await f.db.game.update({ where: { id: f.gameId }, data: { inviteExpiresAt: new Date(0) } });
    else await run(f.first, { type: "block", memberId: f.second });
    expect(await prepareGameChatBootstrap(f.gameId, f.eventId, "stale")).toBeNull();
    expect(await control(f)).toMatchObject({ result: { status: "unavailable" } });
    await expect(f.db.$transaction(tx => assertGameProposalDeliveryCurrentTx({ deliveryIdempotencyKey: f.eventId, containerMemberId: f.room, playerMemberIds: [f.first, f.second], tx }))).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
    await sweep(f);
    expect(await receipt(f)).toMatchObject({ status: "skipped", retryAfterAt: null });
    expect(m.create).not.toHaveBeenCalled();
    if (reason !== "expiry") expect((await f.db.game.findUniqueOrThrow({ where: { id: f.gameId } })).status).toBe("void");
  });
  it.each([false, true])("retires a deleted author's talk before decrypt, queued: %s", async queued => {
    const f = await fixture(); m.phones = queued;
    await talk(f);
    expect((await receipt(f)).status).toBe(queued ? "generation_queued" : "awaiting_generation");
    const prepared = await prepareGameAccountDeletion({ memberIds: [f.second], prisma: f.db });
    await f.db.$transaction(async tx => {
      await applyGameAccountDeletionTx({ memberIds: [f.second], now: new Date(), prepared, tx });
      await tx.hostedMember.delete({ where: { id: f.second } });
    });
    expect((await f.db.game.findUniqueOrThrow({ where: { id: f.gameId } })).status).toBe("void");
    const open = vi.spyOn(crypto, "openGameTexts").mockClear(); m.signal.mockClear();
    expect(await sweep(f)).toMatchObject({ queued: 0 });
    expect(await receipt(f)).toMatchObject({ status: "skipped", retryAfterAt: null });
    const retired = await receipt(f);
    await drainGameChatLifecycle({ prisma: f.db });
    expect(await receipt(f)).toMatchObject({ status: "skipped", retryAfterAt: null, attemptedAt: retired.attemptedAt });
    expect(open.mock.calls.flatMap(([values]) => values).some(value => value.field === `talk_note:${f.proposalId}`)).toBe(false);
    expect(m.signal.mock.calls.some(([call]) => call.expectedUserId === f.room)).toBe(false);
    expect(m.create.mock.calls.some(([call]) => call.idempotencyKey === f.eventId)).toBe(false);
  });
});
