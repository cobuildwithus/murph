import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { parseHostedExecutionWake } from "@murphai/hosted-execution/parsers";
import { getPrisma } from "@/src/lib/prisma";
import { runGameCommand, reserveDueGameMissedDayCheckIns } from "@/src/lib/game/service";
import { gameAudienceKeys } from "@/src/lib/game/audience";
import { sealGameText } from "@/src/lib/game/crypto";
import { readGameChatTranscript } from "@/src/lib/game/chat-tool";
import { reserveGameMissedDayTx, gameGroupMissedDayEventId, gameMissedDayEventId } from "@/src/lib/game/chat-lifecycle-receipt";
import { drainGameChatLifecycle } from "@/src/lib/game/chat-lifecycle";
import { readGroupMissedDayDeliveryAuthority, prepareGroupMissedDay, reserveGroupGameMissedDay, isGroupMissedDayBatchCurrentTx } from "@/src/lib/game/group-missed-day";
import { assertGameProposalDeliveryCurrentTx } from "@/src/lib/game/chat-delivery-authority";
import { readGameProposalDeliveryPlayers } from "@/src/lib/game/chat-delivery";
import { acquireHostedMailboxCausalAppendLockTx, readHostedMailboxWakeByDedupeKey } from "@/src/lib/hosted-mailbox/store";
import { recordHostedLinqRuntimeProviderDispatchFenceTx } from "@/src/lib/hosted-onboarding/linq-delivery-store";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import { createHostedEmailLookupKey, createHostedExternalThreadIdentityLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import { upsertHostedMemberEmailAuthorization } from "@/src/lib/hosted-onboarding/hosted-member-store";

// Same synthetic provider and local KMS boundaries as game-groups-postgres.
const proof = vi.hoisted(() => ({ rooms: new Map<string, string[]>(), signal: vi.fn(), afterPrepare: null as null | (() => Promise<void>) }));
vi.mock("@/src/lib/hosted-onboarding/linq-client", async original => ({ ...await original<object>(),
  getHostedLinqChatSummary: async ({ chatId }: { chatId: string }) => ({ isGroup: true, handlesComplete: true,
    handles: [{ handle: "+15555550100", isMe: true, status: "active" }, ...(proof.rooms.get(chatId) ?? []).map(handle => ({ handle, isMe: false, status: "active" }))] }),
}));
vi.mock("@/src/lib/hosted-routing/assistant-notification-destination", async original => ({ ...await original<object>(),
  readHostedThreadContainerLinqRouteAuthorities: async ({ containerMemberIds }: { containerMemberIds: string[] }) => ({ authorities: new Map(containerMemberIds.map(id => [id,
    { channel: "linq", threadId: id, containerMemberId: id, accountLookupKey: "synthetic-line" }])) }),
  resolveHostedAssistantNotificationDestination: async ({ memberId }: { memberId: string }) => ({ conversationShape: "thread-container",
    route: { channel: "linq", threadId: memberId, threadIsDirect: false, actorId: null, identityId: null, delivery: { kind: "thread", target: memberId } } }),
  bindHostedAssistantNotificationDestination: ({ destination }: { destination: { route: unknown } }) => ({ route: destination.route }),
}));
vi.mock("@/src/lib/hosted-onboarding/linq-line-store", async original => ({ ...await original<object>(), readHostedLinqIncomingLineState: async () => ({ kind: "assignable" }) }));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedMailboxAppendRuntime: proof.signal }));
vi.mock("@/src/lib/hosted-mailbox/store", async original => {
  const actual = await original<typeof import("@/src/lib/hosted-mailbox/store")>();
  return { ...actual, prepareHostedMailboxEnvelopeAppend: async (input: Parameters<typeof actual.prepareHostedMailboxEnvelopeAppend>[0]) => {
    const prepared = await actual.prepareHostedMailboxEnvelopeAppend(input);
    await proof.afterPrepare?.();
    return prepared;
  } };
});
vi.mock("@/src/lib/hosted-crypto/env", async () => {
  const { generateKeyPairSync } = await import("node:crypto");
  const { createHostedAuthorityVerifyKeyring } = await vi.importActual<typeof import("@murphai/runtime-state")>("@murphai/runtime-state");
  const { createHostedGcpKmsClientFromEnv } = await vi.importActual<typeof import("@/src/lib/hosted-crypto/gcp-kms")>("@/src/lib/hosted-crypto/gcp-kms");
  const authoritySignKeyVersionName = "projects/example/locations/global/keyRings/hosted/cryptoKeys/authority/cryptoKeyVersions/1";
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1", privateKeyEncoding: { format: "jwk" }, publicKeyEncoding: { format: "pem", type: "spki" } });
  const gcpKms = createHostedGcpKmsClientFromEnv({ HOSTED_CRYPTO_ENV: "test", HOSTED_CRYPTO_GCP_KMS_API_ROOT: "local://murph-hosted-kms",
    HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK: JSON.stringify(key.privateKey), HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: Buffer.alloc(32, 7).toString("base64"), NODE_ENV: "test" });
  return { getHostedWebCryptoConfig: () => ({ authoritySignKeyVersionName, authoritySignPublicKeyPem: key.publicKey,
    authorityVerifyKeyring: createHostedAuthorityVerifyKeyring({ activeKeyVersionName: authoritySignKeyVersionName, activePublicKeyPem: key.publicKey }),
    env: "test", gcpKms, webWrapKmsKeyName: "projects/example/locations/global/keyRings/hosted/cryptoKeys/missed-proof" }) };
});

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Group missed-day proof requires an isolated local test database.");
const db = getPrisma();
const members: string[] = [], games: string[] = [], events: string[] = [];
const date = "2030-03-04", now = new Date("2030-03-05T09:00:00Z");
function barrier() { let release!: () => void; return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() }; }
async function fixture(count = 3) {
  const people = await Promise.all(Array.from({ length: count }, async (_, seat) => {
    const id = `missed_person_${randomUUID()}`, email = `${randomUUID()}@example.test`;
    members.push(id);
    await db.hostedMember.create({ data: { id } });
    await db.$transaction(tx => upsertHostedMemberEmailAuthorization({ memberId: id, prisma: tx, verifiedEmail: { address: email, verifiedAt: now } }));
    expect((await runGameCommand({ actorMemberId: id, command: { type: "setProfile", firstName: seat < 2 ? "Alex" : "Sam", timeZone: "UTC" } })).ok).toBe(true);
    return { id, email };
  }));
  const roomId = `missed_room_${randomUUID()}`;
  members.push(roomId);
  await db.hostedMember.create({ data: { id: roomId } });
  await db.hostedThreadContainer.create({ data: { memberId: roomId, ownerMemberId: people[0]!.id,
    participants: { create: people.map(person => ({ participantMemberId: person.id, handleLookupKey: createHostedEmailLookupKey(person.email)!, firstSeenAt: now, lastSeenAt: now })) } } });
  await db.hostedThreadRoute.create({ data: { channel: "linq", containerMemberId: roomId, threadLookupKey: `thread_${roomId}`,
    threadIdentityLookupKey: createHostedExternalThreadIdentityLookupKey({ channel: "linq", threadId: roomId })! } });
  proof.rooms.set(roomId, people.map(person => person.email));
  const addGame = async (maxPlayers = 10, zones: string[] = [], joined = count) => {
    const id = randomUUID(); games.push(id);
    const words = await sealGameText({ table: "game", field: "terms_words", rowId: id, memberId: people[0]!.id }, JSON.stringify({ v: 1,
      versions: [{ n: 1, ...(maxPlayers === 10 ? { defaultTask: "Read a chapter" } : {}), tasks: people.map((_, seat) => ({ seat, text: seat >= joined ? "PRIVATE INVITEE TASK" : "Read a chapter" })), stakes: [] }] }));
    await db.game.create({ data: { id, maxPlayers, status: "live", createdBy: people[0]!.id, wordsOwnerMemberId: people[0]!.id,
      audienceKey: maxPlayers === 10 ? gameAudienceKeys(people.map(person => ({ kind: "email", value: person.email }))).current : null,
      chatContainerMemberId: roomId, termsWordsEncrypted: words!, lengthDays: 7, startedAt: new Date(`${date}T00:00:00Z`),
      terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [] }] },
      players: { create: people.slice(0, joined).map((person, seat) => ({ memberId: person.id, seat, timeZone: zones[seat] ?? "UTC", dayOne: new Date(`${date}T00:00:00Z`), joinedAt: new Date(`${date}T00:00:00Z`) })) },
      invitees: { create: people.slice(1).map((person, index) => ({ memberId: person.id, seat: index + 1 })) },
    } });
    return id;
  };
  events.push(gameGroupMissedDayEventId(roomId, date));
  return { roomId, people, addGame };
}
async function receipt(eventId: string) { return db.hostedLinqDelivery.findUniqueOrThrow({ where: { idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(eventId)! } }); }
async function publish(roomId: string, ids: string[], at = now) {
  expect(await reserveGroupGameMissedDay(roomId, ids, at)).toBe(1);
  expect(await drainGameChatLifecycle({ now: at })).toMatchObject({ queued: 1 });
  const authority = await readGroupMissedDayDeliveryAuthority(gameGroupMissedDayEventId(roomId, date), roomId);
  if (!authority) throw new Error("Published mailbox authority is missing");
  return authority;
}
async function assertAndDispatch(authority: NonNullable<Awaited<ReturnType<typeof readGroupMissedDayDeliveryAuthority>>>, tx: Prisma.TransactionClient, at = now) {
  await assertGameProposalDeliveryCurrentTx({ tx, containerMemberId: authority.policy.roomId, audience: authority.audience,
    deliveryIdempotencyKey: authority.policy.eventId, groupMissedPolicy: authority.policy, now: at });
  return recordHostedLinqRuntimeProviderDispatchFenceTx({ prisma: tx, idempotencyKey: authority.policy.eventId, linqChatId: authority.policy.roomId, targetKind: "thread", attemptedAt: at });
}
async function conversation(f: Awaited<ReturnType<typeof fixture>>, text: string) {
  const eventId = randomUUID(), person = f.people[0]!;
  const envelope = parseHostedExecutionWake({ eventId, kind: "conversation.message", userId: f.roomId, occurredAt: now.toISOString(),
      message: { channel: "linq", contactKind: "email", contactLookupKey: createHostedEmailLookupKey(person.email),
        routeAuthority: { channel: "linq", containerMemberId: f.roomId, threadId: f.roomId },
        linqMessage: { chatId: f.roomId, from: person.email, isFromMe: false, threadIsDirect: false, messageId: eventId, parts: [{ type: "text", value: text }] } } });
  if (envelope.kind !== "conversation.message") throw new Error("Expected conversation");
  const store = await vi.importActual<typeof import("@/src/lib/hosted-mailbox/store")>("@/src/lib/hosted-mailbox/store");
  const prepared = await store.prepareHostedMailboxEnvelopeAppend({ envelope, prisma: db });
  return db.$transaction(tx => store.appendPreparedHostedMailboxEnvelopeTx({ prepared, tx }));
}
async function mutateGame(tx: Prisma.TransactionClient, id: string, memberId: string, mutation: string) {
  await tx.$queryRaw`SELECT id FROM game WHERE id = ${id} FOR UPDATE`;
  if (mutation === "departure") await tx.gamePlayer.update({ where: { gameId_seat: { gameId: id, seat: 2 } }, data: { leftAt: now } });
  if (mutation === "terms") await tx.game.update({ where: { id }, data: { terms: { v: 1, versions: [{ n: 2, fromDay: 0, schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [] }] } } });
  if (mutation === "settlement") await tx.game.update({ where: { id }, data: { status: "settled", settledAt: now } });
  if (mutation === "correction") await tx.gameEntry.create({ data: { id: randomUUID(), gameId: id, memberId, dayIndex: 0, attempt: 1, kind: "words", receivedAt: now } });
}
afterEach(async () => {
  proof.afterPrepare = null; proof.signal.mockReset();
  if (!enabled) return;
  await db.hostedLinqDelivery.deleteMany({ where: { OR: [{ payloadOwnerMemberId: { in: members } }, { idempotencyKey: { in: events.map(event => createHostedLinqDeliveryIdempotencyLookupKey(event)!) } }] } });
  await db.game.deleteMany({ where: { id: { in: games } } });
  await db.hostedThreadContainer.deleteMany({ where: { memberId: { in: members } } });
  await db.hostedMember.deleteMany({ where: { id: { in: members } } });
  members.length = 0; games.length = 0; events.length = 0; proof.rooms.clear();
});

describe.skipIf(!enabled)("group missed-day PostgreSQL", () => {
  it("concurrent sweeps publish one encrypted room/date envelope and recover only its pointer", async () => {
    const f = await fixture(4), id = await f.addGame(10, [], 3);
    const claims = await Promise.all([1, 2, 3].map(() => reserveGroupGameMissedDay(f.roomId, [id], now)));
    expect(claims.reduce((a, b) => a + b)).toBe(1);
    await Promise.all([1, 2].map(() => drainGameChatLifecycle({ now })));
    const eventId = gameGroupMissedDayEventId(f.roomId, date);
    const wake = await readHostedMailboxWakeByDedupeKey({ userId: f.roomId, dedupeKey: eventId });
    expect(wake?.kind).toBe("assistant.notification.requested");
    if (wake?.kind !== "assistant.notification.requested") throw new Error("Missing notification");
    expect(wake.notification.responsePolicy).toMatchObject({ kind: "game_group_missed_check_in", roomId: f.roomId,
      batch: [{ gameId: id, remainingMemberIds: f.people.slice(0, 3).map(person => person.id).sort() }] });
    expect(wake.notification.instructions).not.toContain("PRIVATE INVITEE TASK");
    expect(wake.notification.instructions).toContain("Alex (1)");
    expect(wake.notification.instructions).toContain("Alex (2)");
    const rows = await db.hostedMailboxItem.findMany({ where: { userId: f.roomId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payloadInlineCiphertext ?? rows[0]!.payloadRef).toBeTruthy();
    await db.hostedLinqDelivery.update({ where: { id: (await receipt(eventId)).id }, data: { retryAfterAt: now } });
    proof.afterPrepare = async () => { throw new Error("Must not regenerate"); };
    expect(await drainGameChatLifecycle({ now })).toMatchObject({ queued: 1 });
    expect(await db.hostedMailboxItem.count({ where: { userId: f.roomId } })).toBe(1);
    expect(await reserveGroupGameMissedDay(f.roomId, [id], now)).toBe(0);
  });

  it.each([false, true])("uses the Tokyo/Los Angeles horizon in mixed rooms, western post=%s", async posted => {
    const f = await fixture(2), pair = await f.addGame(2, ["Asia/Tokyo", "Asia/Tokyo"]), group = await f.addGame(10, ["Asia/Tokyo", "America/Los_Angeles"]);
    if (posted) await db.gameEntry.create({ data: { id: randomUUID(), gameId: group, memberId: f.people[1]!.id, dayIndex: 0, attempt: 1, kind: "words", receivedAt: now } });
    const early = new Date("2030-03-05T00:00:00Z"), late = new Date("2030-03-05T17:00:00Z");
    expect(await reserveGroupGameMissedDay(f.roomId, [pair, group], early)).toBe(0);
    expect(await db.$transaction(tx => reserveGameMissedDayTx({ tx, gameId: pair, memberId: f.people[0]!.id,
      playerMemberIds: f.people.map(person => person.id), firstMissedDate: date, dueAt: early }))).toBe(false);
    const authority = await publish(f.roomId, [pair, group], late);
    expect(authority.policy.batch.find(game => game.gameId === group)?.misses).toHaveLength(posted ? 1 : 2);
    expect(authority.policy.batch.find(game => game.gameId === pair)?.misses).toHaveLength(2);
  });

  it("collects twenty games before claiming and detects overflow", async () => {
    const f = await fixture(2), ids: string[] = [];
    for (let index = 0; index < 20; index++) ids.push(await f.addGame(index < 10 ? 2 : 10));
    const prepared = await prepareGroupMissedDay(f.roomId, date, now);
    expect(prepared?.policy.batch).toHaveLength(20);
    expect(await reserveGroupGameMissedDay(f.roomId, ids, now)).toBe(1);
    ids.push(await f.addGame());
    expect(await prepareGroupMissedDay(f.roomId, date, now)).toBeNull();
    expect(await reserveGroupGameMissedDay(f.roomId, ids, now)).toBe(0);
  });

  it("pages room identities without slicing a room's games across discovery pages", async () => {
    const f = await fixture(2);
    await f.addGame(2); await f.addGame();
    const [bucket] = await db.$queryRaw<Array<{ shard: number }>>`SELECT mod(abs(hashtext(${f.roomId})::bigint), 60)::int AS shard`;
    const at = new Date(now.getTime() + bucket!.shard * 60_000);
    const prefix = `a_missed_${randomUUID()}_`;
    const rooms = await db.$queryRaw<Array<{ id: string }>>`SELECT ${prefix} || n AS id FROM generate_series(1, 20000) AS n
      WHERE mod(abs(hashtext(${prefix} || n)::bigint), 60) = ${bucket!.shard} ORDER BY id LIMIT 100`;
    expect(rooms).toHaveLength(100);
    members.push(...rooms.map(room => room.id));
    await db.hostedMember.createMany({ data: rooms });
    const decoys = rooms.map(room => ({ id: randomUUID(), maxPlayers: 2, status: "live", createdBy: f.people[0]!.id,
      wordsOwnerMemberId: f.people[0]!.id, chatContainerMemberId: room.id, lengthDays: 7, termsWordsEncrypted: "unused-structural-fixture",
      terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [] }] } }));
    games.push(...decoys.map(game => game.id));
    await db.game.createMany({ data: decoys });
    expect(await reserveDueGameMissedDayCheckIns(at)).toBe(1);
    expect(await drainGameChatLifecycle({ now: at })).toMatchObject({ queued: 1 });
    expect((await readGroupMissedDayDeliveryAuthority(gameGroupMissedDayEventId(f.roomId, date), f.roomId))?.policy.batch).toHaveLength(2);
  });

  it("serializes pair and group contenders under the verified two-contact pair lock", async () => {
    const f = await fixture(2), pair = await f.addGame(2), group = await f.addGame();
    const prepared = await prepareGroupMissedDay(f.roomId, date, now);
    if (!prepared) throw new Error("Expected authorized mixed room");
    const locked = barrier(), release = barrier();
    const groupClaim = db.$transaction(tx => reserveGameMissedDayTx({ tx, roomId: f.roomId, firstMissedDate: date, dueAt: now,
      pairMemberIds: prepared.audience.memberIds, beforeClaim: async tx => {
        const current = await isGroupMissedDayBatchCurrentTx(prepared.policy, prepared.audience, tx, now);
        locked.release(); await release.promise; return current;
      } }));
    await Promise.race([locked.promise, groupClaim.then(() => { throw new Error("Claim did not reach barrier"); })]);
    try {
      await expect(db.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '100ms'");
        return reserveGameMissedDayTx({ tx, gameId: pair, memberId: f.people[0]!.id,
          playerMemberIds: f.people.map(person => person.id), firstMissedDate: date, dueAt: now });
      })).rejects.toThrow(/lock timeout/u);
    } finally { release.release(); }
    expect(await groupClaim).toBe(true);
    expect(await reserveGroupGameMissedDay(f.roomId, [pair, group], now)).toBe(0);
    expect(await drainGameChatLifecycle({ now })).toMatchObject({ queued: 1 });
    expect(await db.hostedMailboxItem.count({ where: { userId: f.roomId } })).toBe(1);
  });

  it.each(["quiet", "sent", "settled", "uncertain"])("honors an earlier pair hash after %s", async state => {
    const f = await fixture(2), pair = await f.addGame(2), eventId = gameMissedDayEventId(pair, f.people[0]!.id, date);
    events.push(eventId);
    expect(await db.$transaction(tx => reserveGameMissedDayTx({ tx, gameId: pair, memberId: f.people[0]!.id,
      playerMemberIds: f.people.map(person => person.id), firstMissedDate: date, dueAt: now }))).toBe(true);
    await db.hostedLinqDelivery.update({ where: { id: (await receipt(eventId)).id }, data: state === "quiet" ? { status: "skipped", skippedAt: now }
      : { status: state === "uncertain" ? "provider_dispatch_started" : "sent", source: "hosted_runtime_linq_delivery", template: null, sourceRef: "rewritten" } });
    if (state === "settled") await db.game.update({ where: { id: pair }, data: { status: "settled", settledAt: now } });
    const group = await f.addGame();
    expect(await reserveGroupGameMissedDay(f.roomId, state === "settled" ? [group] : [pair, group], now)).toBe(0);
  });

  it.each(["departure", "terms", "settlement", "correction"])("suppresses publication when %s wins the game lock", async mutation => {
    const f = await fixture(), id = await f.addGame();
    expect(await reserveGroupGameMissedDay(f.roomId, [id], now)).toBe(1);
    const captured = barrier(), release = barrier();
    proof.afterPrepare = async () => { captured.release(); await release.promise; };
    const draining = drainGameChatLifecycle({ now });
    await Promise.race([captured.promise, draining.then(() => { throw new Error("Publication did not reach the barrier"); })]);
    await db.$transaction(tx => mutateGame(tx, id, f.people[0]!.id, mutation));
    release.release(); await draining;
    expect(await db.hostedMailboxItem.count({ where: { userId: f.roomId } })).toBe(0);
    expect((await receipt(gameGroupMissedDayEventId(f.roomId, date))).status).toBe("skipped");
  });

  it.each(["departure", "terms", "settlement", "correction"])("suppresses dispatch when %s wins the game lock", async mutation => {
    const f = await fixture(), id = await f.addGame(), authority = await publish(f.roomId, [id]);
    const locked = barrier(), release = barrier();
    const changing = db.$transaction(async tx => { await mutateGame(tx, id, f.people[0]!.id, mutation); locked.release(); await release.promise; });
    await Promise.race([locked.promise, changing.then(() => { throw new Error("Mutation did not reach barrier"); })]);
    const dispatch = db.$transaction(tx => assertAndDispatch(authority, tx));
    const rejected = expect(dispatch).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
    release.release(); await changing; await rejected;
    expect((await receipt(authority.policy.eventId)).status).toBe("generation_queued");
  });

  it.each(["I missed my post because my train was cancelled.", "Anyone reading something good?"])("suppresses delayed replay after committed room conversation: %s", async text => {
    const f = await fixture(), id = await f.addGame(), authority = await publish(f.roomId, [id]);
    const appended = await conversation(f, text);
    await db.hostedMailboxItem.update({ where: { id: appended.mailboxItemId }, data: { consumedAt: now } });
    expect(await readGameChatTranscript({ containerMemberId: f.roomId, playerNamesByMemberId: [{ memberId: f.people[0]!.id, name: "Alex (1)" }], since: new Date(`${date}T00:00:00Z`) })).toEqual([{ playerName: "Alex (1)", text }]);
    expect(await readGameChatTranscript({ containerMemberId: f.roomId, playerNamesByMemberId: [{ memberId: f.people[0]!.id, name: "Alex (1)" }], since: new Date(`${date}T00:00:00Z`), throughConversationLaneSeq: authority.policy.conversationLaneSeq })).toEqual([]);
    await expect(db.$transaction(tx => assertAndDispatch(authority, tx))).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
    await db.hostedLinqDelivery.update({ where: { id: (await receipt(authority.policy.eventId)).id }, data: { retryAfterAt: now } });
    expect(await drainGameChatLifecycle({ now })).toMatchObject({ queued: 0 });
    expect((await receipt(authority.policy.eventId)).status).toBe("skipped");
    expect(await reserveGroupGameMissedDay(f.roomId, [id], now)).toBe(0);
    expect(await db.hostedMailboxItem.count({ where: { userId: f.roomId, kind: "assistant.notification.requested" } })).toBe(1);
  });

  it("suppresses an explanation received between transcript capture and publication", async () => {
    const f = await fixture(), id = await f.addGame();
    expect(await reserveGroupGameMissedDay(f.roomId, [id], now)).toBe(1);
    proof.afterPrepare = async () => { await conversation(f, "I already explained my missing post."); };
    expect(await drainGameChatLifecycle({ now })).toMatchObject({ queued: 0 });
    expect(await db.hostedMailboxItem.count({ where: { userId: f.roomId, kind: "assistant.notification.requested" } })).toBe(0);
    expect((await receipt(gameGroupMissedDayEventId(f.roomId, date))).status).toBe("skipped");
  });

  it("serializes overlapping batches supplied in opposite orders without deadlock", async () => {
    const f = await fixture(), ids = [await f.addGame(), await f.addGame()], authority = await publish(f.roomId, ids);
    expect(await Promise.all([authority.policy, { ...authority.policy, batch: [...authority.policy.batch].reverse() }]
      .map(policy => db.$transaction(tx => isGroupMissedDayBatchCurrentTx(policy, authority.audience, tx, now))))).toEqual([true, true]);
  });

  it("rolls back mailbox publication with receipt advancement, then retries once", async () => {
    const f = await fixture(), id = await f.addGame();
    expect(await reserveGroupGameMissedDay(f.roomId, [id], now)).toBe(1);
    const eventId = gameGroupMissedDayEventId(f.roomId, date), claimed = await receipt(eventId);
    proof.afterPrepare = async () => { await db.hostedLinqDelivery.update({ where: { id: claimed.id }, data: { status: "synthetic_failure" } }); };
    await drainGameChatLifecycle({ now });
    expect(await db.hostedMailboxItem.count({ where: { userId: f.roomId } })).toBe(0);
    proof.afterPrepare = null;
    await db.hostedLinqDelivery.update({ where: { id: claimed.id }, data: { status: "awaiting_generation", retryAfterAt: now } });
    expect(await drainGameChatLifecycle({ now })).toMatchObject({ queued: 1 });
    expect(await db.hostedMailboxItem.count({ where: { userId: f.roomId } })).toBe(1);
  });

  it.each(["conversation", "system"])("rechecks only the conversation watermark after a %s write", async lane => {
    const f = await fixture(), id = await f.addGame(), authority = await publish(f.roomId, [id]);
    await db.$transaction(async tx => {
      await acquireHostedMailboxCausalAppendLockTx({ tx, userId: f.roomId });
      await tx.hostedMailboxItem.create({ data: { id: randomUUID(), userId: f.roomId, lane, laneSeq: 999n,
        dedupeKey: randomUUID(), kind: lane === "conversation" ? "conversation.message" : "assistant.notification.requested", occurredAt: now, payloadSchema: "synthetic-unused" } });
    });
    if (lane === "conversation") {
      await expect(db.$transaction(tx => assertAndDispatch(authority, tx))).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
      expect(await reserveGroupGameMissedDay(f.roomId, [id], now)).toBe(0);
    } else expect((await db.$transaction(tx => assertAndDispatch(authority, tx))).claimed).toBe(true);
  });

  it("holds game locks until dispatch claims, even with reverse batch ordering", async () => {
    const f = await fixture(), ids = [await f.addGame(), await f.addGame()], authority = await publish(f.roomId, ids);
    const locked = barrier(), release = barrier();
    const dispatch = db.$transaction(async tx => {
      expect(await isGroupMissedDayBatchCurrentTx({ ...authority.policy, batch: [...authority.policy.batch].reverse() }, authority.audience, tx, now)).toBe(true);
      locked.release(); await release.promise;
      return assertAndDispatch(authority, tx);
    });
    await Promise.race([locked.promise, dispatch.then(() => { throw new Error("Dispatch did not reach the barrier"); })]);
    const mutation = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM game WHERE id = ${ids[0]} FOR UPDATE`;
      await tx.gamePlayer.update({ where: { gameId_seat: { gameId: ids[0]!, seat: 2 } }, data: { leftAt: now } });
    });
    release.release();
    expect((await dispatch).claimed).toBe(true); await mutation;
    await expect(db.$transaction(tx => assertAndDispatch(authority, tx))).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
    expect((await receipt(authority.policy.eventId)).status).toBe("provider_dispatch_started");
  });

  it("allows a subsequent date after a historical departure and suppresses a new nonaffected departure", async () => {
    const f = await fixture(4), id = await f.addGame();
    await db.gamePlayer.update({ where: { gameId_seat: { gameId: id, seat: 3 } }, data: { leftAt: new Date("2030-03-04T12:00:00Z") } });
    await db.gameEntry.create({ data: { id: randomUUID(), gameId: id, memberId: f.people[2]!.id, dayIndex: 0, attempt: 1, kind: "words", receivedAt: now } });
    const authority = await publish(f.roomId, [id]);
    expect(authority.policy.batch[0]!.remainingMemberIds).toHaveLength(3);
    expect(authority.policy.batch[0]!.misses).toHaveLength(2);
    expect(await db.$transaction(tx => isGroupMissedDayBatchCurrentTx(authority.policy, authority.audience, tx, now))).toBe(true);
    await db.gamePlayer.update({ where: { gameId_seat: { gameId: id, seat: 2 } }, data: { leftAt: now } });
    await expect(db.$transaction(tx => assertAndDispatch(authority, tx))).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
  });

  it("requires exact encrypted mailbox authority and rejects added outsiders at egress", async () => {
    const f = await fixture(), id = await f.addGame(), authority = await publish(f.roomId, [id]);
    expect(await readGameProposalDeliveryPlayers(authority.policy.eventId, f.roomId, f.roomId)).toMatchObject({ policy: authority.policy });
    await expect(readGameProposalDeliveryPlayers(authority.policy.eventId, f.roomId, "other-room")).rejects.toThrow();
    proof.rooms.get(f.roomId)!.push("outsider@example.test");
    await expect(readGameProposalDeliveryPlayers(authority.policy.eventId, f.roomId, f.roomId)).rejects.toThrow();
    await expect(assertGameProposalDeliveryCurrentTx({ tx: db, deliveryIdempotencyKey: authority.policy.eventId, containerMemberId: f.roomId })).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
  });
});
