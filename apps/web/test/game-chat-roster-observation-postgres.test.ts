import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "@/src/lib/prisma";
import { prepareGameChatBootstrap, reconcileFrozenGameChatBootstrap } from "@/src/lib/game/chat-bootstrap";
import { sealHostedUserSecureBoxString } from "@/src/lib/hosted-crypto/secure-box";
import { drainGameChatLifecycle } from "@/src/lib/game/chat-lifecycle";
import { gameChatLifecycleEventId, reserveGameChatLifecycleTx } from "@/src/lib/game/chat-lifecycle-receipt";
import { readGameChatFundingRooms } from "@/src/lib/game/chat-access";
import { exactChat } from "@/src/lib/game/chat-membership";
import { gameAudienceKeys } from "@/src/lib/game/audience";
import { createHostedPhoneLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import { localRosterCrypto, rosterPhoneIdentity, rosterRoute, syntheticPhone } from "./support/roster-postgres";
import { linqRoster } from "./support/linq-roster";

const provider = vi.hoisted(() => ({ read: vi.fn(), signal: vi.fn() }));
vi.mock("@/src/lib/hosted-onboarding/linq-client", async original => ({
  ...await original<typeof import("@/src/lib/hosted-onboarding/linq-client")>(), getHostedLinqChatSummary: provider.read,
}));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedMailboxAppendRuntime: provider.signal }));
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test(?:_[a-z0-9_]+)?$/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Game roster proof requires its isolated local test database.");

// The drain's missed-day sweep parses these on the minute a room's shard comes up.
const storedTerms = { v: 1, versions: [{ fromDay: 0, n: 1, schedule: { count: 7 }, stakes: [] }] };

describe.skipIf(!enabled)("game roster leases and pointer recovery on migrated PostgreSQL", () => {
  const db = getPrisma();
  let room: string, a: string, b: string, game: string, chat: string, lineKey: string, line: string;
  let phones: string[], now: Date, observedAt: Date, old: Date;
  let bootstrapRoom: string | null;
  beforeEach(async () => {
    localRosterCrypto();
    bootstrapRoom = null;
    provider.read.mockReset(); provider.signal.mockReset();
    [room, a, b, game, chat] = Array.from({ length: 5 }, () => randomUUID());
    phones = [syntheticPhone(), syntheticPhone()]; line = syntheticPhone();
    now = new Date(); observedAt = new Date(now.getTime() - 1_000); old = new Date(now.getTime() - 8 * 86_400_000);
    await db.hostedMember.createMany({ data: [room, a, b].map(id => ({ id, billingStatus: "not_started" })) });
    for (const [index, id] of [a, b].entries()) await rosterPhoneIdentity(db, id, phones[index], old);
    await db.hostedThreadContainer.create({ data: { memberId: room, ownerMemberId: a,
      participants: { create: [a, b].map((participantMemberId, i) => ({ participantMemberId,
        handleLookupKey: createHostedPhoneLookupKey(phones[i])!, firstSeenAt: old, lastSeenAt: old })) } } });
    lineKey = await rosterRoute(db, room, chat, line);
    await db.gameProfile.createMany({ data: [a, b].map(memberId => ({ memberId, firstNameEncrypted: "synthetic", timeZone: "UTC" })) });
    provider.read.mockResolvedValue(linqRoster({ observedAt, handles: [
      { handle: line, isMe: true, status: "active" }, ...phones.map(handle => ({ handle, isMe: false, status: "active" })),
    ] }));
  });
  afterEach(async () => {
    await db.hostedLinqDelivery.deleteMany({ where: { sourceRef: game } });
    await db.game.deleteMany({ where: { id: game } });
    await db.hostedGroup.deleteMany({ where: { ownerMemberId: { in: [a, b] } } });
    await db.hostedThreadContainer.deleteMany({ where: { memberId: { in: [room, ...(bootstrapRoom ? [bootstrapRoom] : [])] } } });
    await db.hostedMember.deleteMany({ where: { id: { in: [room, a, b, ...(bootstrapRoom ? [bootstrapRoom] : [])] } } });
    await db.hostedLinqLine.deleteMany({ where: { phoneNumberLookupKey: lineKey } });
    await db.hostedGroupParticipantObservation.deleteMany({ where: { contactLookupKey: { in: phones.map(phone => createHostedPhoneLookupKey(phone)!) } } });
    vi.unstubAllEnvs();
  });
  async function pointer(group = false, consumed = false) {
    await db.game.create({ data: { id: game, maxPlayers: group ? 10 : 2, status: "live", createdBy: a, wordsOwnerMemberId: a,
      chatContainerMemberId: room, terms: storedTerms, termsWordsEncrypted: "synthetic",
      audienceKey: group ? gameAudienceKeys(phones.map(value => ({ kind: "phone", value }))).current : null,
      invitees: { create: { seat: 1, memberId: b } },
      players: { create: [a, b].map((memberId, seat) => ({ memberId, seat, joinedAt: now, timeZone: "UTC" })) } } });
    await reserveGameChatLifecycleTx({ gameId: game, kind: "started", now: old, tx: db });
    const eventId = gameChatLifecycleEventId(game, "started");
    const receipt = await db.hostedLinqDelivery.update({ where: { idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(eventId)! },
      data: { status: "generation_queued", retryAfterAt: old, payloadOwnerMemberId: room } });
    await db.hostedMailboxItem.create({ data: { id: randomUUID(), userId: room, dedupeKey: eventId, kind: "assistant.notification.requested",
      lane: "system", laneSeq: 1n, occurredAt: old, payloadSchema: "murph.hosted-execution.assistant-notification-requested.v1" } });
    // System checkpoints advance the lane floor; they never stamp consumedAt.
    if (consumed) await db.hostedMailboxLaneCounter.upsert({ where: { userId_lane: { userId: room, lane: "system" } },
      create: { userId: room, lane: "system", nextSeq: 2n, consumedSeq: 1n }, update: { nextSeq: 2n, consumedSeq: 1n } });
    return receipt.id;
  }
  const rows = () => db.hostedThreadContainerParticipant.findMany({ where: { containerMemberId: room } });
  it.each([false, true])("renews expired game-only funding before recovering a published pointer, group=%s", async group => {
    await pointer(group);
    expect(await readGameChatFundingRooms({ memberIds: [room], now, prisma: db })).toEqual(new Map());
    expect(await drainGameChatLifecycle({ now, prisma: db })).toMatchObject({ queued: 1 });
    expect((await rows()).every(row => row.lastSeenAt.getTime() === observedAt.getTime())).toBe(true);
    expect(await readGameChatFundingRooms({ memberIds: [room], now, prisma: db })).toEqual(new Map([[room, room]]));
    expect(provider.signal).toHaveBeenCalledOnce();
  });
  it.each(["removed", "stale extra"])("recovers from the game's own pair when a participant row is %s", async kind => {
    await pointer();
    if (kind === "removed") await db.hostedThreadContainerParticipant.updateMany({ where: { containerMemberId: room, participantMemberId: b }, data: { removedAt: old } });
    else await db.hostedThreadContainerParticipant.create({ data: { containerMemberId: room, participantMemberId: room,
      handleLookupKey: createHostedPhoneLookupKey(syntheticPhone())!, firstSeenAt: old, lastSeenAt: old } });
    expect(await drainGameChatLifecycle({ now, prisma: db })).toMatchObject({ queued: 1 });
    expect((await rows()).filter(row => row.removedAt === null).map(row => row.participantMemberId).sort()).toEqual([a, b].sort());
    expect(provider.signal).toHaveBeenCalledOnce();
  });
  it.each(["changed", "partial"])("does not renew or signal a pair with a %s roster", async kind => {
    const receiptId = await pointer();
    provider.read.mockResolvedValue(linqRoster({ observedAt, handlesComplete: kind !== "partial", handles: [
      { handle: line, isMe: true, status: "active" }, ...[phones[0], kind === "changed" ? syntheticPhone() : phones[1]].map(handle => ({ handle, isMe: false, status: "active" })),
    ] }));
    await drainGameChatLifecycle({ now, prisma: db });
    expect((await rows()).every(row => row.lastSeenAt.getTime() === old.getTime())).toBe(true);
    expect(provider.signal).not.toHaveBeenCalled();
    expect(await db.hostedLinqDelivery.findUniqueOrThrow({ where: { id: receiptId } })).toMatchObject({ status: "generation_queued", retryAfterAt: expect.any(Date) });
  });
  it("does not let an older verified game read undo a newer removal", async () => {
    await db.hostedThreadContainerParticipant.updateMany({ where: { containerMemberId: room, participantMemberId: b }, data: { removedAt: now } });
    expect(await exactChat(room, phones)).not.toBeNull();
    expect((await rows()).find(row => row.participantMemberId === b)).toMatchObject({ removedAt: now, lastSeenAt: old });
  });
  it("keeps bootstrap participant creation separate from roster reconciliation through route attachment", async () => {
    await db.game.create({ data: { id: game, status: "live", createdBy: a, wordsOwnerMemberId: a,
      terms: storedTerms, termsWordsEncrypted: "synthetic",
      players: { create: [a, b].map((memberId, seat) => ({ memberId, seat, joinedAt: now, timeZone: "UTC" })) } } });
    const eventId = gameChatLifecycleEventId(game, "started");
    await reserveGameChatLifecycleTx({ gameId: game, kind: "started", now, tx: db });
    bootstrapRoom = await prepareGameChatBootstrap(game, eventId, "Start the shared challenge.");
    expect(bootstrapRoom).toBeTruthy();
    if (!bootstrapRoom) throw new Error("Expected a bootstrap room.");
    const created = await db.hostedThreadContainerParticipant.findMany({ where: { containerMemberId: bootstrapRoom } });
    expect(created.map(row => row.participantMemberId).sort()).toEqual([a, b].sort());
    expect(created.every(row => row.firstSeenAt.getTime() === row.lastSeenAt.getTime())).toBe(true);
    expect(provider.read).not.toHaveBeenCalled();
    // An accepted receipt can attach its route without rewriting existing participant evidence.
    await db.hostedThreadContainerParticipant.updateMany({ where: { containerMemberId: bootstrapRoom }, data: { lastSeenAt: old, removedAt: now } });
    const receipt = await db.hostedLinqDelivery.findUniqueOrThrow({ where: { idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(eventId)! } });
    const payloadCiphertext = await sealHostedUserSecureBoxString({ lane: "hosted-member-private-field", scope: "game-chat-receipt", userId: bootstrapRoom,
      aad: { table: "hosted_linq_delivery", rowId: receipt.id, field: "payload_ciphertext", purpose: "game-chat-receipt" }, prisma: db,
      value: JSON.stringify({ gameId: game, eventId, from: line, to: phones, message: "Start the shared challenge.", accountLookupKey: lineKey,
        chatId: randomUUID(), messageId: randomUUID(), acceptedAt: now.toISOString() }) });
    await db.hostedLinqDelivery.update({ where: { id: receipt.id }, data: { status: "accepted", payloadSchema: "game_chat_bootstrap_v1", payloadCiphertext } });
    expect(await reconcileFrozenGameChatBootstrap(game, eventId, bootstrapRoom)).toBe(true);
    expect(await db.hostedThreadRoute.count({ where: { containerMemberId: bootstrapRoom } })).toBe(1);
    const attached = await db.hostedThreadContainerParticipant.findMany({ where: { containerMemberId: bootstrapRoom } });
    expect(attached.every(row => row.lastSeenAt.getTime() === old.getTime() && row.removedAt?.getTime() === now.getTime())).toBe(true);
    expect(await db.hostedThreadContainer.findUniqueOrThrow({ where: { memberId: bootstrapRoom } })).toMatchObject({ completeRosterObservedAt: null });
    expect(await db.hostedGroupParticipantObservation.count({ where: { contactLookupKey: { in: phones.map(phone => createHostedPhoneLookupKey(phone)!) } } })).toBe(0);
  });
  it("clears a consumed pair pointer deadline without a provider read", async () => {
    const receiptId = await pointer(false, true);
    await drainGameChatLifecycle({ now, prisma: db });
    expect(provider.read).not.toHaveBeenCalled(); expect(provider.signal).not.toHaveBeenCalled();
    expect(await db.hostedLinqDelivery.findUniqueOrThrow({ where: { id: receiptId } })).toMatchObject({ retryAfterAt: null });
  });
});
