import { linqRoster } from "./support/linq-roster";
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { parseHostedExecutionWake } from "@murphai/hosted-execution/parsers";
import { getPrisma } from "@/src/lib/prisma";
import { runGameCommand, reserveDueGameMissedDayCheckIns } from "@/src/lib/game/service";
import { gameAudienceKeys } from "@/src/lib/game/audience";
import { sealGameText } from "@/src/lib/game/crypto";
import { readGameChatTranscript } from "@/src/lib/game/chat-tool";
import { gameChatLifecycleEventId, reserveGameChatLifecycleTx, reserveGameMissedDayTx, gameGroupMissedDayEventId, gameMissedDayEventId } from "@/src/lib/game/chat-lifecycle-receipt";
import { drainGameChatLifecycle, readOldestReceiptPerChat } from "@/src/lib/game/chat-lifecycle";
import { GameChatAudienceError } from "@/src/lib/game/chat-membership";
import { readGroupMissedDayDeliveryAuthority, prepareGroupMissedDay, reserveGroupGameMissedDay, isGroupMissedDayBatchCurrentTx } from "@/src/lib/game/group-missed-day";
import { gameEveningEventId, isEveningBatchCurrentTx, prepareGameEveningCheckIn, readGameEveningDeliveryAuthority, reserveGameEveningCheckIn } from "@/src/lib/game/evening-check-in";
import { assertGameProposalDeliveryCurrentTx } from "@/src/lib/game/chat-delivery-authority";
import { readGameProposalDeliveryPlayers } from "@/src/lib/game/chat-delivery";
import { advanceHostedMailboxConsumedSeqByLane, acquireHostedMailboxCausalAppendLockTx, readHostedMailboxWakeByDedupeKey } from "@/src/lib/hosted-mailbox/store";
import { recordHostedLinqRuntimeProviderDispatchFenceTx } from "@/src/lib/hosted-onboarding/linq-delivery-store";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import { createHostedEmailLookupKey, createHostedExternalThreadIdentityLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { upsertHostedMemberIdentity } from "@/src/lib/hosted-onboarding/hosted-member-identity-store";
import { upsertHostedMemberEmailAuthorization } from "@/src/lib/hosted-onboarding/hosted-member-store";
import { buildHostedMemberPhoneIdentityFields } from "@/src/lib/hosted-onboarding/member-identity-fields";

// Same synthetic provider and local KMS boundaries as game-groups-postgres.
const proof = vi.hoisted(() => ({ rooms: new Map<string, string[]>(), chatFailures: new Map<string, unknown>(), parsedChats: new Set<string>(), realRoutes: new Set<string>(), audienceReads: [] as string[], signal: vi.fn(), afterPrepare: null as null | (() => Promise<void>) }));
vi.mock("@/src/lib/hosted-onboarding/linq-client", async original => {
  const actual = await original<typeof import("@/src/lib/hosted-onboarding/linq-client")>();
  return { ...actual, getHostedLinqChatSummary: async (input: Parameters<typeof actual.getHostedLinqChatSummary>[0]) => {
    proof.audienceReads.push(`chat:${input.chatId}`);
    if (proof.chatFailures.has(input.chatId)) throw proof.chatFailures.get(input.chatId);
    if (proof.parsedChats.has(input.chatId)) return actual.getHostedLinqChatSummary(input);
    return linqRoster({ isGroup: true, handlesComplete: true,
      handles: [{ handle: "+15555550100", isMe: true, status: "active" }, ...(proof.rooms.get(input.chatId) ?? []).map(handle => ({ handle, isMe: false, status: "active" }))] });
  } };
});
vi.mock("@/src/lib/hosted-routing/assistant-notification-destination", async original => { const actual = await original<typeof import("@/src/lib/hosted-routing/assistant-notification-destination")>(); return { ...actual,
  readHostedThreadContainerLinqRouteAuthorities: async (input: Parameters<typeof actual.readHostedThreadContainerLinqRouteAuthorities>[0]) => {
    proof.audienceReads.push(...input.containerMemberIds.map(id => `route:${id}`));
    return input.containerMemberIds.some(id => proof.realRoutes.has(id))
      ? actual.readHostedThreadContainerLinqRouteAuthorities(input)
      : { nonLinqContainerMemberIds: new Set<string>(), unavailableContainerMemberIds: new Set<string>(), authorities: new Map(input.containerMemberIds.map(id => [id,
        { channel: "linq" as const, threadId: id, containerMemberId: id, accountLookupKey: "synthetic-line" }])) };
  },
  resolveHostedAssistantNotificationDestination: async ({ memberId }: { memberId: string }) => ({ conversationShape: "thread-container",
    route: { channel: "linq", threadId: memberId, threadIsDirect: false, actorId: null, identityId: null, delivery: { kind: "thread", target: memberId } } }),
  bindHostedAssistantNotificationDestination: ({ destination }: { destination: { route: unknown } }) => ({ route: destination.route }),
}; });
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
async function fixture(count = 3, roomId = `missed_room_${randomUUID()}`, sharedPeople?: Array<{ id: string; email: string }>) {
  const people = sharedPeople ?? await Promise.all(Array.from({ length: count }, async (_, seat) => {
    const id = `missed_person_${randomUUID()}`, email = `${randomUUID()}@example.test`;
    members.push(id);
    await db.hostedMember.create({ data: { id } });
    await db.$transaction(tx => upsertHostedMemberEmailAuthorization({ memberId: id, prisma: tx, verifiedEmail: { address: email, verifiedAt: now } }));
    expect((await runGameCommand({ actorMemberId: id, command: { type: "setProfile", firstName: seat < 2 ? "Alex" : "Sam", timeZone: "UTC" } })).ok).toBe(true);
    return { id, email };
  }));
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
/** Rooms the sweep visits at the pinned `now`, in visiting order, so no case depends on the wall clock. */
async function shardRooms(count: number, shard = Math.floor(now.getTime() / 60_000) % 60) {
  const prefix = `missed_room_${randomUUID()}_`;
  const rooms = await db.$queryRaw<Array<{ id: string }>>`SELECT ${prefix} || n AS id FROM generate_series(1, 2000) AS n
    WHERE mod(abs(hashtext(${prefix} || n)::bigint), 60) = ${shard} ORDER BY id LIMIT ${count}`;
  expect(rooms).toHaveLength(count);
  return rooms.map(room => room.id);
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
/** One drain with a broken room first in its shard: the next room still claims and an older delivery still publishes. */
async function drainPastBrokenRoom(reason: string, breakRoom: (f: Fixture) => unknown) {
  const [badId, healthyId, pendingId] = await shardRooms(3);
  const bad = await fixture(3, badId), healthy = await fixture(3, healthyId), pending = await fixture(3, pendingId);
  await bad.addGame(); await healthy.addGame();
  expect(await reserveGroupGameMissedDay(pending.roomId, [await pending.addGame()], now)).toBe(1);
  const pendingEvent = gameGroupMissedDayEventId(pending.roomId, date);
  await breakRoom(bad);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  await drainGameChatLifecycle({ now });

  expect((await receipt(pendingEvent)).status).toBe("generation_queued");
  expect((await receipt(gameGroupMissedDayEventId(healthy.roomId, date))).status).toBe("generation_queued");
  expect(await db.hostedLinqDelivery.count({ where: { payloadOwnerMemberId: bad.roomId } })).toBe(0);
  expect(await db.hostedMailboxItem.count({ where: { userId: bad.roomId } })).toBe(0);
  expect(warn).toHaveBeenCalledWith(expect.any(String), { warning: "game.missed-day.room-skipped", reason });
  const logged = JSON.stringify(warn.mock.calls);
  for (const value of [bad.roomId, ...bad.people.flatMap(person => [person.id, person.email]), ...proof.rooms.get(bad.roomId)!]) expect(logged).not.toContain(value);
  return bad;
}
/** The pass rejects with the plain failure, so nothing reports this room as skipped. */
async function expectPassStopped(f: Fixture, message: string) {
  const failure = await drainGameChatLifecycle({ now }).then(() => null, (error: unknown) => error);
  expect(failure).toBeInstanceOf(Error);
  expect(failure).not.toBeInstanceOf(GameChatAudienceError);
  expect(failure).toMatchObject({ message });
  expect(await db.hostedLinqDelivery.count({ where: { payloadOwnerMemberId: f.roomId } })).toBe(0);
}
/** Serves this room's chat read through the real Linq client and parser. */
function parsedChat(roomId: string, payload: unknown) {
  vi.stubEnv("LINQ_API_TOKEN", "synthetic-token");
  proof.parsedChats.add(roomId);
  const read = vi.fn(async () => Response.json(payload));
  vi.stubGlobal("fetch", read);
  return read;
}
function chatHandles(f: Fixture) {
  return [{ handle: "+15555550100", is_me: true, status: "active" }, ...f.people.map(person => ({ handle: person.email, is_me: false, status: "active" }))];
}
/** A second member behind one handle mid key rotation: each lookup key is unique, and reads match both. */
async function secondMemberBehind(write: (memberId: string) => Promise<unknown>) {
  const id = `missed_person_${randomUUID()}`;
  members.push(id);
  await db.hostedMember.create({ data: { id } });
  vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", `${process.env.HOSTED_CONTACT_PRIVACY_KEYS!},v99:${Buffer.alloc(32, 19).toString("base64url")}`);
  vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", "v99");
  await write(id);
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
beforeAll(async () => {
  if (!enabled) return;
  // CI runs PostgreSQL files serially in one database; park lifecycle receipts left by earlier suites so this file's global drain sees only its own.
  await db.hostedLinqDelivery.updateMany({ where: { source: "game_lifecycle", status: { in: ["awaiting_generation", "generation_queued"] } }, data: { retryAfterAt: new Date("9999-01-01T00:00:00Z") } });
});
afterEach(async () => {
  proof.afterPrepare = null; proof.signal.mockReset(); proof.chatFailures.clear(); proof.parsedChats.clear(); proof.realRoutes.clear(); proof.audienceReads.length = 0;
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  if (!enabled) return;
  await db.hostedLinqDelivery.deleteMany({ where: { OR: [{ payloadOwnerMemberId: { in: members } }, { idempotencyKey: { in: events.map(event => createHostedLinqDeliveryIdempotencyLookupKey(event)!) } }] } });
  await db.game.deleteMany({ where: { id: { in: games } } });
  await db.hostedThreadContainer.deleteMany({ where: { memberId: { in: members } } });
  await db.hostedMember.deleteMany({ where: { id: { in: members } } });
  members.length = 0; games.length = 0; events.length = 0; proof.rooms.clear();
});

describe.skipIf(!enabled)("group missed-day PostgreSQL", () => {
  const eveningAt = new Date("2030-03-04T20:05:00Z");
  it("reserves one evening per room and date, and freezes the addressed batch and watermark", async () => {
    vi.stubEnv("MURPH_GAME_EVENING_CHECK_IN_ENABLED", "true");
    const f = await fixture(3), id = await f.addGame();
    const eventId = gameEveningEventId(f.roomId, date); events.push(eventId);
    expect(await reserveGameEveningCheckIn(f.roomId, [id], eveningAt)).toBe(1);
    expect(await reserveGameEveningCheckIn(f.roomId, [id], eveningAt)).toBe(0);
    const row = await receipt(eventId);
    expect(row).toMatchObject({ template: "game_evening", sourceRef: `${f.roomId}:${date}`, payloadOwnerMemberId: f.roomId });
    const prepared = await prepareGameEveningCheckIn(f.roomId, date, eveningAt);
    expect(prepared?.policy.batch).toEqual([{ gameId: id, termsVersion: 1, memberIds: f.people.map(person => person.id).sort(), dayIndex: 0 }]);
    expect(prepared?.policy.expiresAt).toBe("2030-03-04T20:30:00.000Z");
  });

  it("suppresses unjoined and far-apart audiences, and excludes a switched-off player", async () => {
    vi.stubEnv("MURPH_GAME_EVENING_CHECK_IN_ENABLED", "true");
    const unjoined = await fixture(3), unjoinedId = await unjoined.addGame(10, [], 2);
    expect(await reserveGameEveningCheckIn(unjoined.roomId, [unjoinedId], eveningAt)).toBe(0);
    const far = await fixture(3), farId = await far.addGame();
    await db.gameProfile.update({ where: { memberId: far.people[2]!.id }, data: { timeZone: "America/Los_Angeles" } });
    expect(await reserveGameEveningCheckIn(far.roomId, [farId], eveningAt)).toBe(0);
    const close = await fixture(3), closeId = await close.addGame();
    await db.gamePlayer.update({ where: { gameId_seat: { gameId: closeId, seat: 2 } }, data: { reminderOff: true } });
    const eventId = gameEveningEventId(close.roomId, date); events.push(eventId);
    expect(await reserveGameEveningCheckIn(close.roomId, [closeId], eveningAt)).toBe(1);
    expect((await prepareGameEveningCheckIn(close.roomId, date, eveningAt))?.policy.batch[0]?.memberIds).toEqual(close.people.slice(0, 2).map(person => person.id).sort());
  });

  it("reserves the same evening family for an exact two-player pair room", async () => {
    vi.stubEnv("MURPH_GAME_EVENING_CHECK_IN_ENABLED", "true");
    const f = await fixture(2), id = await f.addGame(2);
    expect(await reserveGameEveningCheckIn(f.roomId, [id], eveningAt)).toBe(0);
    const phones = ["+12025550181", "+12025550182"];
    for (const [index, person] of f.people.entries()) await db.$transaction(tx => upsertHostedMemberIdentity({
      ...buildHostedMemberPhoneIdentityFields(phones[index]!), memberId: person.id, prisma: tx,
      phoneNumberVerifiedAt: now, signupPhoneCodeSendAttemptId: null, signupPhoneCodeSendAttemptStartedAt: null,
      signupPhoneCodeSentAt: null, signupPhoneNumber: null }));
    proof.rooms.set(f.roomId, phones);
    const eventId = gameEveningEventId(f.roomId, date); events.push(eventId);
    expect(await reserveGameEveningCheckIn(f.roomId, [id], eveningAt)).toBe(1);
    expect((await prepareGameEveningCheckIn(f.roomId, date, eveningAt))?.policy.batch[0]?.memberIds).toEqual(f.people.map(person => person.id).sort());
  });

  it("does not reserve when an authorized room recipient has unresolved identity", async () => {
    vi.stubEnv("MURPH_GAME_EVENING_CHECK_IN_ENABLED", "true");
    const f = await fixture(3), id = await f.addGame();
    const unknown = `${randomUUID()}@example.test`;
    await db.gameInvitee.create({ data: { gameId: id, seat: 3, memberId: null, recipientLookupKey: createHostedEmailLookupKey(unknown) } });
    proof.rooms.set(f.roomId, [...f.people.map(person => person.email), unknown]);
    expect(await reserveGameEveningCheckIn(f.roomId, [id], eveningAt)).toBe(0);
  });

  it("combines pair and group games in one mixed-room evening witness", async () => {
    vi.stubEnv("MURPH_GAME_EVENING_CHECK_IN_ENABLED", "true");
    const f = await fixture(2), pair = await f.addGame(2), group = await f.addGame(10);
    const eventId = gameEveningEventId(f.roomId, date); events.push(eventId);
    expect(await reserveGameEveningCheckIn(f.roomId, [pair, group], eveningAt)).toBe(1);
    expect((await prepareGameEveningCheckIn(f.roomId, date, eveningAt))?.policy.batch.map(game => game.gameId).sort()).toEqual([pair, group].sort());
  });

  it("keeps the flag off and rejects expiry", async () => {
    const f = await fixture(2), id = await f.addGame();
    const eventId = gameEveningEventId(f.roomId, date); events.push(eventId);
    vi.stubEnv("MURPH_GAME_EVENING_CHECK_IN_ENABLED", "false");
    expect(await reserveGameEveningCheckIn(f.roomId, [id], eveningAt)).toBe(0);
    vi.stubEnv("MURPH_GAME_EVENING_CHECK_IN_ENABLED", "true");
    expect(await reserveGameEveningCheckIn(f.roomId, [id], new Date("2030-03-04T20:30:00Z"))).toBe(0);
    expect(await reserveGameEveningCheckIn(f.roomId, [id], eveningAt)).toBe(1);
    const prepared = await prepareGameEveningCheckIn(f.roomId, date, eveningAt);
    expect(prepared).not.toBeNull();
    expect(await db.$transaction(tx => isEveningBatchCurrentTx(prepared!.policy, prepared!.memberIds, prepared!.audience, tx, new Date("2030-03-04T20:30:00Z")))).toBe(false);
    expect(await drainGameChatLifecycle({ now: new Date("2030-03-04T20:31:00Z") })).toMatchObject({ queued: 0 });
    expect(await receipt(eventId)).toMatchObject({ status: "skipped", skipReason: "game_evening_expired" });
  });

  it.each(["post", "leave", "opt-out", "terms", "message"] as const)("makes a frozen evening stale after %s", async mutation => {
    vi.stubEnv("MURPH_GAME_EVENING_CHECK_IN_ENABLED", "true");
    const f = await fixture(3), id = await f.addGame();
    const eventId = gameEveningEventId(f.roomId, date); events.push(eventId);
    expect(await reserveGameEveningCheckIn(f.roomId, [id], eveningAt)).toBe(1);
    const prepared = await prepareGameEveningCheckIn(f.roomId, date, eveningAt);
    expect(prepared).not.toBeNull();
    if (mutation === "post") await db.gameEntry.create({ data: { id: randomUUID(), gameId: id, memberId: f.people[0]!.id, dayIndex: 0,
      attempt: 1, kind: "words", receivedAt: eveningAt } });
    if (mutation === "leave") await db.gamePlayer.update({ where: { gameId_seat: { gameId: id, seat: 2 } }, data: { leftAt: eveningAt } });
    if (mutation === "opt-out") await db.gamePlayer.update({ where: { gameId_seat: { gameId: id, seat: 1 } }, data: { reminderOff: true } });
    if (mutation === "terms") await db.game.update({ where: { id }, data: { terms: { v: 1, versions: [{ n: 2, fromDay: 0,
      schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [] }] } } });
    if (mutation === "message") await conversation(f, "I'm doing my task today.");
    expect(await db.$transaction(tx => isEveningBatchCurrentTx(prepared!.policy, prepared!.memberIds, prepared!.audience, tx, eveningAt))).toBe(false);
  });

  it("publishes an evening witness and reads it from the mailbox for final authority", async () => {
    vi.stubEnv("MURPH_GAME_EVENING_CHECK_IN_ENABLED", "true");
    const f = await fixture(3), id = await f.addGame();
    const eventId = gameEveningEventId(f.roomId, date); events.push(eventId);
    expect(await reserveGameEveningCheckIn(f.roomId, [id], eveningAt)).toBe(1);
    expect(await drainGameChatLifecycle({ now: eveningAt })).toMatchObject({ queued: 1 });
    const authority = await readGameEveningDeliveryAuthority(eventId, f.roomId);
    expect(authority?.policy.batch[0]?.gameId).toBe(id);
    expect(await db.$transaction(tx => isEveningBatchCurrentTx(authority!.policy, authority!.memberIds, authority!.audience, tx, eveningAt))).toBe(true);
    await conversation(f, "I'll do it today.");
    await expect(db.$transaction(tx => assertGameProposalDeliveryCurrentTx({ tx, deliveryIdempotencyKey: eventId,
      containerMemberId: f.roomId, playerMemberIds: authority!.memberIds, audience: authority!.audience,
      eveningPolicy: authority!.policy, now: eveningAt }))).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
  });

  it("pauses after three accepted scheduled evenings even when delivery metadata was rewritten", async () => {
    vi.stubEnv("MURPH_GAME_EVENING_CHECK_IN_ENABLED", "true");
    const f = await fixture(3), id = await f.addGame();
    const fourth = "2030-03-07", at = new Date("2030-03-07T20:05:00Z");
    for (const day of ["2030-03-04", "2030-03-05", "2030-03-06"]) {
      const eventId = gameEveningEventId(f.roomId, day); events.push(eventId);
      await db.hostedLinqDelivery.create({ data: { id: randomUUID(), idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(eventId),
        source: "hosted_runtime_linq_delivery", sourceRef: "rewritten", template: "other", status: "accepted",
        targetKind: "thread", attemptedAt: new Date(`${day}T20:00:00Z`), acceptedAt: new Date(`${day}T20:01:00Z`) } });
    }
    const fourthEvent = gameEveningEventId(f.roomId, fourth); events.push(fourthEvent);
    expect(await reserveGameEveningCheckIn(f.roomId, [id], at)).toBe(0);
    await conversation(f, "I'm here.");
    expect(await reserveGameEveningCheckIn(f.roomId, [id], at)).toBe(1);
  });

  it.each(["skipped", "failed"] as const)("does not count a %s evening toward the three-send pause", async status => {
    vi.stubEnv("MURPH_GAME_EVENING_CHECK_IN_ENABLED", "true");
    const f = await fixture(3), id = await f.addGame();
    for (const day of ["2030-03-04", "2030-03-05", "2030-03-06"]) {
      const eventId = gameEveningEventId(f.roomId, day); events.push(eventId);
      await db.hostedLinqDelivery.create({ data: { id: randomUUID(), idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(eventId),
        source: "hosted_runtime_linq_delivery", sourceRef: "rewritten", template: "other", status: day === "2030-03-05" ? status : "accepted",
        targetKind: "thread", attemptedAt: new Date(`${day}T20:00:00Z`),
        acceptedAt: day === "2030-03-05" ? null : new Date(`${day}T20:01:00Z`) } });
    }
    const fourth = gameEveningEventId(f.roomId, "2030-03-07"); events.push(fourth);
    expect(await reserveGameEveningCheckIn(f.roomId, [id], new Date("2030-03-07T20:05:00Z"))).toBe(1);
  });

  it("gives ten evening rooms ten drain slots while keeping one room ordered", async () => {
    const roomIds = Array.from({ length: 10 }, () => `evening_room_${randomUUID()}`);
    for (const roomId of roomIds) {
      members.push(roomId);
      await db.hostedMember.create({ data: { id: roomId } });
      for (const [index, day] of ["2030-03-04", ...(roomId === roomIds[0] ? ["2030-03-05"] : [])].entries()) {
        const eventId = gameEveningEventId(roomId, day); events.push(eventId);
        await db.hostedLinqDelivery.create({ data: { id: randomUUID(), idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(eventId),
          source: "game_lifecycle", sourceRef: `${roomId}:${day}`, template: "game_evening", status: "awaiting_generation",
          targetKind: "thread", payloadOwnerMemberId: roomId, attemptedAt: new Date(index * 1_000), retryAfterAt: new Date(0) } });
      }
    }
    const selected = await readOldestReceiptPerChat(db, new Date("2030-03-06T20:00:00Z"));
    expect(selected).toHaveLength(10);
    expect(new Set(selected.map(row => row.payloadOwnerMemberId)).size).toBe(10);
    expect(selected.find(row => row.payloadOwnerMemberId === roomIds[0])?.sourceRef).toBe(`${roomIds[0]}:2030-03-04`);
  });
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
      playerMemberIds: f.people.map(person => person.id), firstMissedDate: date, dueAt: early, now: early }))).toBe(false);
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

  it("skips a room with one person left in the text, and its next shard visit retries", async () => {
    const bad = await drainPastBrokenRoom("participants_changed", f => { proof.rooms.set(f.roomId, [f.people[0]!.email]); });
    // Nothing was recorded, so the room's next shard visit inside the window claims normally.
    proof.rooms.set(bad.roomId, bad.people.map(person => person.email));
    await reserveDueGameMissedDayCheckIns(new Date(now.getTime() + 60 * 60_000));
    expect((await receipt(gameGroupMissedDayEventId(bad.roomId, date))).status).toBe("awaiting_generation");
  });

  it("skips a room the provider readably reports is not a group", async () => {
    await drainPastBrokenRoom("participants_changed", f => { parsedChat(f.roomId, { is_group: false, handles: chatHandles(f) }); });
  });

  it("skips a room whose only route is on another channel", async () => {
    await drainPastBrokenRoom("route_unavailable", async f => {
      proof.realRoutes.add(f.roomId);
      await db.hostedThreadRoute.updateMany({ where: { containerMemberId: f.roomId }, data: { channel: "telegram" } });
    });
  });

  it("skips a room whose email handle resolves to two members", async () => {
    await drainPastBrokenRoom("identity_ambiguous", f => secondMemberBehind(id => db.$transaction(tx => upsertHostedMemberEmailAuthorization({
      memberId: id, prisma: tx, verifiedEmail: { address: f.people[0]!.email, verifiedAt: now } }))));
  });

  it("skips a room whose phone handle resolves to two members", async () => {
    const phone = "+12025550172";
    const claimPhone = (memberId: string) => db.$transaction(tx => upsertHostedMemberIdentity({ ...buildHostedMemberPhoneIdentityFields(phone), memberId, prisma: tx,
      phoneNumberVerifiedAt: now, signupPhoneCodeSendAttemptId: null, signupPhoneCodeSendAttemptStartedAt: null, signupPhoneCodeSentAt: null, signupPhoneNumber: null }));
    await drainPastBrokenRoom("identity_ambiguous", async f => {
      await claimPhone(f.people[0]!.id); await secondMemberBehind(claimPhone);
      proof.rooms.set(f.roomId, [phone, ...f.people.map(person => person.email)]);
    });
  });

  it("stops the pass when the real route reader cannot open a room's route", async () => {
    const [roomId] = await shardRooms(1), f = await fixture(3, roomId);
    await f.addGame(); proof.realRoutes.add(f.roomId);
    const open = vi.spyOn(await import("@/src/lib/hosted-routing/thread-delivery-route"), "openHostedThreadDeliveryRoute").mockRejectedValue(new Error("Synthetic KMS outage."));
    await expectPassStopped(f, "Game chat route is unavailable.");
    expect(open).toHaveBeenCalledOnce();
  });

  it("stops the pass on a bound room with no route row, which deletion never leaves behind", async () => {
    const [roomId] = await shardRooms(1), f = await fixture(3, roomId);
    await f.addGame(); proof.realRoutes.add(f.roomId);
    await db.hostedThreadRoute.deleteMany({ where: { containerMemberId: f.roomId } });
    await expectPassStopped(f, "Game chat route is unavailable.");
  });

  it.each([
    ["a wrong-typed is_group", (f: Fixture) => ({ is_group: "true", handles: chatHandles(f) })],
    ["no is_group", (f: Fixture) => ({ handles: chatHandles(f) })],
    ["handles that are not a list", () => ({ is_group: true, handles: "none" })],
    ["one unparseable handle", (f: Fixture) => ({ is_group: true, handles: [...chatHandles(f), { handle: "" }] })],
    ["an unparseable handle in a non-group", (f: Fixture) => ({ is_group: false, handles: [...chatHandles(f), { handle: "" }] })],
  ] as const)("stops the pass on a provider response with %s", async (_shape, payload) => {
    const [roomId] = await shardRooms(1), f = await fixture(3, roomId);
    await f.addGame();
    const read = parsedChat(f.roomId, payload(f));
    await expectPassStopped(f, "The game's chat participants have changed.");
    expect(read).toHaveBeenCalledOnce();
  });

  it.each([
    ["a database outage", () => { const failure = new Prisma.PrismaClientInitializationError("Can't reach database server.", "synthetic"); vi.spyOn(db.gameBlock, "findFirst").mockRejectedValue(failure); return failure; }],
    ["a provider timeout", (roomId: string) => { const failure = hostedOnboardingError({ code: "LINQ_SEND_FAILED", httpStatus: 502, message: "Linq chat read timed out.", retryable: true }); proof.chatFailures.set(roomId, failure); return failure; }],
    ["a provider rejection", (roomId: string) => { const failure = hostedOnboardingError({ code: "LINQ_SEND_FAILED", httpStatus: 502, message: "Linq chat read failed with HTTP 401.", details: { failureStage: "http", status: 401 } }); proof.chatFailures.set(roomId, failure); return failure; }],
    ["a provider 404", (roomId: string) => { const failure = hostedOnboardingError({ code: "LINQ_SEND_FAILED", httpStatus: 502, message: "Linq chat read failed with HTTP 404.", details: { failureStage: "http", status: 404 } }); proof.chatFailures.set(roomId, failure); return failure; }],
    ["an unexpected defect", (roomId: string) => { const failure = new TypeError("Synthetic defect."); proof.chatFailures.set(roomId, failure); return failure; }],
  ] as const)("stops the pass on %s instead of reporting a skipped room", async (_kind, inject) => {
    const [roomId] = await shardRooms(1), f = await fixture(3, roomId);
    await f.addGame();
    const failure = inject(f.roomId);
    await expect(drainGameChatLifecycle({ now })).rejects.toBe(failure);
    expect(await db.hostedLinqDelivery.count({ where: { payloadOwnerMemberId: f.roomId } })).toBe(0);
  });

  it.each([
    ["before the day closes", "2030-03-04T12:00:00Z"],
    ["just before its window", "2030-03-05T08:59:59Z"],
    ["just after its window", "2030-03-05T11:00:01Z"],
  ])("makes no provider or audience read %s", async (_when, at) => {
    const f = await fixture(), id = await f.addGame();
    expect(await reserveGroupGameMissedDay(f.roomId, [id], new Date(at))).toBe(0);
    expect(proof.audienceReads).toEqual([]);
    expect(await db.hostedLinqDelivery.count({ where: { payloadOwnerMemberId: f.roomId } })).toBe(0);
  });

  it.each([
    ["the start of its window", "2030-03-05T09:00:00Z"],
    ["the end of its window", "2030-03-05T11:00:00Z"],
  ])("reads the audience once and claims at %s", async (_when, at) => {
    const f = await fixture(), id = await f.addGame();
    expect(await reserveGroupGameMissedDay(f.roomId, [id], new Date(at))).toBe(1);
    expect(proof.audienceReads).toEqual([`route:${f.roomId}`, `chat:${f.roomId}`]);
    expect((await receipt(gameGroupMissedDayEventId(f.roomId, date))).retryAfterAt).toEqual(now);
  });

  it.each([
    ["a pair game in a three-person room", 3, (f: Fixture) => f.addGame(2, ["America/Los_Angeles", "America/Los_Angeles"], 2)],
    ["a group game with a player outside the text", 4, (f: Fixture) => f.addGame(10, f.people.map(() => "America/Los_Angeles"))],
  ] as const)("claims at the kept game's time when %s has a later horizon", async (_excluded, count, addExcluded) => {
    const f = await fixture(count), kept = await f.addGame(10, [], 3), excluded = await addExcluded(f);
    proof.rooms.set(f.roomId, f.people.slice(0, 3).map(person => person.email));
    expect(await reserveGroupGameMissedDay(f.roomId, [kept, excluded], now)).toBe(1);
    expect((await receipt(gameGroupMissedDayEventId(f.roomId, date))).retryAfterAt).toEqual(now);
    expect((await prepareGroupMissedDay(f.roomId, date, now))?.policy.batch.map(game => game.gameId)).toEqual([kept]);
  });

  it("claims at a horizon set by a game with no miss of its own", async () => {
    const f = await fixture(2), missed = await f.addGame(), posted = await f.addGame(10, f.people.map(() => "America/Los_Angeles"));
    for (const person of f.people) await db.gameEntry.create({ data: { id: randomUUID(), gameId: posted, memberId: person.id, dayIndex: 0, attempt: 1, kind: "words", receivedAt: now } });
    // The missed game's own window costs a read but cannot move the room's later horizon.
    expect(await reserveGroupGameMissedDay(f.roomId, [missed, posted], now)).toBe(0);
    expect(proof.audienceReads).toContain(`chat:${f.roomId}`);
    const late = new Date("2030-03-05T17:00:00Z");
    expect(await reserveGroupGameMissedDay(f.roomId, [missed, posted], late)).toBe(1);
    expect((await receipt(gameGroupMissedDayEventId(f.roomId, date))).retryAfterAt).toEqual(late);
  });

  it("skips a due room with an unsendable audience and warns", async () => {
    const f = await fixture(), id = await f.addGame();
    proof.rooms.set(f.roomId, [f.people[0]!.email]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await reserveGroupGameMissedDay(f.roomId, [id], now)).toBe(0);
    expect(proof.audienceReads).toEqual([`route:${f.roomId}`, `chat:${f.roomId}`]);
    expect(warn).toHaveBeenCalledExactlyOnceWith(expect.any(String), { warning: "game.missed-day.room-skipped", reason: "participants_changed" });
  });

  it("reads nothing and logs nothing for a not-due room with an unsendable audience", async () => {
    const f = await fixture(), id = await f.addGame();
    proof.rooms.set(f.roomId, [f.people[0]!.email]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await reserveGroupGameMissedDay(f.roomId, [id], new Date(now.getTime() - 1_000))).toBe(0);
    expect(proof.audienceReads).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  const hours = (count: number) => new Date(now.getTime() + count * 3_600_000);
  const deadline = hours(2), justLate = new Date(deadline.getTime() + 1);
  const outage = () => hostedOnboardingError({ code: "LINQ_SEND_FAILED", httpStatus: 502, message: "Linq chat read timed out.", retryable: true });
  const heldUp = [
    ["an unsendable room", (f: Fixture) => { proof.rooms.set(f.roomId, [f.people[0]!.email]); }],
    ["a provider outage", (f: Fixture) => { proof.chatFailures.set(f.roomId, outage()); }],
  ] as const;
  const recover = (f: Fixture) => { proof.chatFailures.clear(); proof.rooms.set(f.roomId, f.people.map(person => person.email)); };
  /** Shard 17 is off every drain below, so the pre-sweep never meets this room's injected outage. */
  async function reservedRoom() {
    const [roomId] = await shardRooms(1, 17), f = await fixture(3, roomId), id = await f.addGame();
    expect(await reserveGroupGameMissedDay(f.roomId, [id], now)).toBe(1);
    return { f, id, eventId: gameGroupMissedDayEventId(f.roomId, date) };
  }
  /** First in the single-slot batch, so another suite's leftover room in this shared database cannot take the turn. */
  async function turn(eventId: string, at: Date) {
    await db.hostedLinqDelivery.update({ where: { id: (await receipt(eventId)).id }, data: { attemptedAt: new Date(0) } });
    return drainGameChatLifecycle({ now: at });
  }
  async function expectEnded(f: Fixture, eventId: string, warn: { mock: { calls: unknown[][] } }) {
    expect(await receipt(eventId)).toMatchObject({ status: "skipped", skipReason: "game_missed_check_in_expired", skippedAt: justLate, retryAfterAt: null });
    expect(proof.audienceReads).toEqual([]);
    expect(await db.hostedMailboxItem.count({ where: { userId: f.roomId } })).toBe(0);
    expect(warn.mock.calls).toContainEqual([expect.any(String), { warning: "game.missed-day.expired", reason: "past_deadline" }]);
    const logged = JSON.stringify(warn.mock.calls);
    for (const value of [f.roomId, eventId, ...f.people.flatMap(person => [person.id, person.email])]) expect(logged).not.toContain(value);
  }

  it.each(heldUp)("keeps a fresh receipt held up by %s pending, then delivers once the room recovers", async (_cause, breakRoom) => {
    const { f, eventId } = await reservedRoom();
    breakRoom(f);
    expect(await turn(eventId, hours(.5))).toMatchObject({ attempted: 1, queued: 0 });
    expect((await receipt(eventId)).status).toBe("awaiting_generation");
    expect(proof.audienceReads).toContain(`chat:${f.roomId}`);
    recover(f);
    expect(await turn(eventId, hours(1))).toMatchObject({ attempted: 1, queued: 1 });
    expect((await receipt(eventId)).status).toBe("generation_queued");
    expect(await db.hostedMailboxItem.count({ where: { userId: f.roomId } })).toBe(1);
  });

  it.each(heldUp)("ends a receipt held up by %s past its deadline with no Linq read", async (_cause, breakRoom) => {
    const { f, eventId } = await reservedRoom();
    breakRoom(f);
    await turn(eventId, hours(.5));
    proof.audienceReads.length = 0;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await turn(eventId, justLate)).toMatchObject({ attempted: 1, queued: 0 });
    await expectEnded(f, eventId, warn);
  });

  it.each(heldUp)("sends nothing to a room that recovers after %s outlasted the deadline", async (_cause, breakRoom) => {
    const { f, eventId } = await reservedRoom();
    breakRoom(f);
    await turn(eventId, hours(.5));
    recover(f); proof.audienceReads.length = 0;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await turn(eventId, justLate);
    await expectEnded(f, eventId, warn);
    await drainGameChatLifecycle({ now: hours(73) });
    expect((await receipt(eventId)).attemptedAt).toEqual(justLate);
    expect(await db.hostedMailboxItem.count({ where: { userId: f.roomId } })).toBe(0);
    expect(proof.signal).not.toHaveBeenCalled();
  });

  it.each([["exactly at", deadline, "awaiting_generation"], ["just past", justLate, "skipped"]] as const)("treats a receipt %s its deadline correctly", async (_side, at, status) => {
    const { f, eventId } = await reservedRoom();
    proof.rooms.set(f.roomId, [f.people[0]!.email]);
    await turn(eventId, at);
    expect((await receipt(eventId)).status).toBe(status);
  });

  it.each([false, true])("keeps an existing pointer and checks authority before signalling; audience changed=%s", async changed => {
    const f = await fixture(), authority = await publish(f.roomId, [await f.addGame()]), eventId = authority.policy.eventId;
    await db.hostedLinqDelivery.update({ where: { id: (await receipt(eventId)).id }, data: { status: "awaiting_generation", retryAfterAt: justLate } });
    proof.audienceReads.length = 0; proof.signal.mockClear();
    if (changed) proof.rooms.set(f.roomId, f.people.slice(0, 2).map(person => person.email));
    expect(await turn(eventId, justLate)).toMatchObject({ attempted: 1, queued: 1 });
    expect(await receipt(eventId)).toMatchObject({ status: "awaiting_generation", skippedAt: null });
    expect(await db.hostedMailboxItem.count({ where: { userId: f.roomId } })).toBe(1);
    expect(proof.audienceReads).toEqual([`route:${f.roomId}`, `chat:${f.roomId}`]);
    expect(proof.signal).toHaveBeenCalledTimes(changed ? 0 : 1);
  });

  it.each([["unconsumed", null], ["consumed", now]] as const)("takes a published %s check-in out of the sweep past its deadline without dropping it", async (_state, consumedAt) => {
    const f = await fixture(), authority = await publish(f.roomId, [await f.addGame()]), eventId = authority.policy.eventId;
    if (consumedAt) {
      const item = await db.hostedMailboxItem.findFirstOrThrow({ where: { userId: f.roomId, lane: "system" } });
      await advanceHostedMailboxConsumedSeqByLane({ userId: f.roomId, prisma: db, lanes: [{ lane: "system", consumedSeq: item.laneSeq }] });
    }
    proof.rooms.set(f.roomId, [f.people[0]!.email]); proof.audienceReads.length = 0; proof.signal.mockClear();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await turn(eventId, justLate)).toMatchObject({ attempted: 1, queued: 0 });
    expect(await receipt(eventId)).toMatchObject({ status: "generation_queued", retryAfterAt: null, skippedAt: null });
    expect(proof.audienceReads).toEqual([]);
    expect(proof.signal).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.any(String), { warning: "game.missed-day.expired", reason: "past_deadline" });
    await drainGameChatLifecycle({ now: hours(3) });
    expect((await receipt(eventId)).attemptedAt).toEqual(justLate);
  });

  it.each([["exactly at", deadline, true], ["just past", justLate, false]] as const)("egress allows an outbox retry %s the deadline only if fresh", async (_side, at, allowed) => {
    const f = await fixture(), authority = await publish(f.roomId, [await f.addGame()]);
    const dispatch = db.$transaction(tx => assertAndDispatch(authority, tx, at));
    if (allowed) expect((await dispatch).claimed).toBe(true);
    else await expect(dispatch).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
    expect((await receipt(authority.policy.eventId)).status).toBe(allowed ? "provider_dispatch_started" : "generation_queued");
  });

  it("leaves a receipt alone once dispatch has started", async () => {
    const f = await fixture(), authority = await publish(f.roomId, [await f.addGame()]);
    await db.$transaction(tx => assertAndDispatch(authority, tx));
    await db.hostedLinqDelivery.update({ where: { id: (await receipt(authority.policy.eventId)).id }, data: { retryAfterAt: justLate } });
    await turn(authority.policy.eventId, justLate);
    expect(await receipt(authority.policy.eventId)).toMatchObject({ status: "provider_dispatch_started", attemptedAt: new Date(0), skippedAt: null });
  });

  it("stops a publication that loses the race to an expiry", async () => {
    const { f, eventId } = await reservedRoom();
    proof.afterPrepare = async () => { await db.hostedLinqDelivery.update({ where: { id: (await receipt(eventId)).id }, data: { status: "skipped" } }); };
    expect(await turn(eventId, hours(.5))).toMatchObject({ attempted: 1, queued: 0 });
    expect(await db.hostedMailboxItem.count({ where: { userId: f.roomId } })).toBe(0);
  });

  it("ends a stuck receipt without holding up a healthy one, and gives it no further turn", async () => {
    const stuck = await reservedRoom(), healthy = await fixture(), healthyId = await healthy.addGame();
    proof.rooms.set(stuck.f.roomId, [stuck.f.people[0]!.email]);
    expect(await reserveGroupGameMissedDay(healthy.roomId, [healthyId], hours(1.5))).toBe(1);
    await turn(stuck.eventId, justLate);
    expect((await receipt(stuck.eventId)).status).toBe("skipped");
    expect((await receipt(gameGroupMissedDayEventId(healthy.roomId, date))).status).toBe("generation_queued");
    proof.audienceReads.length = 0;
    await drainGameChatLifecycle({ now: new Date(justLate.getTime() + 60_000) });
    expect((await receipt(stuck.eventId)).attemptedAt).toEqual(justLate);
    expect(proof.audienceReads.filter(read => read.endsWith(stuck.f.roomId))).toEqual([]);
  });

  it("clears a receipt that was already stuck, with no migration", async () => {
    const { f, eventId } = await reservedRoom();
    proof.rooms.set(f.roomId, [f.people[0]!.email]);
    // A row from before this change: a database-default createdAt and a months-old retry history.
    await db.hostedLinqDelivery.update({ where: { id: (await receipt(eventId)).id }, data: { createdAt: hours(-24 * 90), retryAfterAt: hours(-1) } });
    await turn(eventId, now);
    expect(await receipt(eventId)).toMatchObject({ status: "skipped", skipReason: "game_missed_check_in_expired" });
  });

  it.each([["while live", false], ["after the game settled", true]])("ends a stuck pair receipt past its deadline %s", async (_when, settled) => {
    const f = await fixture(2), id = await f.addGame(2), eventId = gameMissedDayEventId(id, f.people[0]!.id, date);
    events.push(eventId);
    expect(await db.$transaction(tx => reserveGameMissedDayTx({ tx, gameId: id, memberId: f.people[0]!.id, playerMemberIds: f.people.map(person => person.id), firstMissedDate: date, dueAt: now, now }))).toBe(true);
    if (settled) await db.game.update({ where: { id }, data: { status: "settled", settledAt: now } });
    expect(await turn(eventId, hours(.5))).toMatchObject({ attempted: 1, queued: 0 });
    expect((await receipt(eventId)).status).toBe("awaiting_generation");
    proof.audienceReads.length = 0;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await turn(eventId, justLate);
    await expectEnded(f, eventId, warn);
  });

  it("serializes pair and group contenders under the verified two-contact pair lock", async () => {
    const f = await fixture(2), pair = await f.addGame(2), group = await f.addGame();
    const prepared = await prepareGroupMissedDay(f.roomId, date, now);
    if (!prepared) throw new Error("Expected authorized mixed room");
    const locked = barrier(), release = barrier();
    const groupClaim = db.$transaction(tx => reserveGameMissedDayTx({ tx, roomId: f.roomId, firstMissedDate: date, dueAt: now, now,
      pairMemberIds: prepared.audience.memberIds, beforeClaim: async tx => {
        const current = await isGroupMissedDayBatchCurrentTx(prepared.policy, prepared.audience, tx, now);
        locked.release(); await release.promise; return current;
      } }));
    await Promise.race([locked.promise, groupClaim.then(() => { throw new Error("Claim did not reach barrier"); })]);
    try {
      await expect(db.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '100ms'");
        return reserveGameMissedDayTx({ tx, gameId: pair, memberId: f.people[0]!.id,
          playerMemberIds: f.people.map(person => person.id), firstMissedDate: date, dueAt: now, now });
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
      playerMemberIds: f.people.map(person => person.id), firstMissedDate: date, dueAt: now, now }))).toBe(true);
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

describe.skipIf(!enabled)("lifecycle batch", () => {
  /** Due receipts, oldest first and ahead of anything else in the shared database. Shard 17 keeps the pre-sweep away. */
  async function dueRooms(count: number) {
    const rooms = [];
    for (const [index, roomId] of (await shardRooms(count, 17)).entries()) {
      const f = await fixture(2, roomId), id = await f.addGame();
      expect(await reserveGroupGameMissedDay(f.roomId, [id], now)).toBe(1);
      const eventId = gameGroupMissedDayEventId(f.roomId, date);
      await db.hostedLinqDelivery.update({ where: { id: (await receipt(eventId)).id }, data: { attemptedAt: new Date(index * 1_000) } });
      rooms.push({ f, id, eventId });
    }
    return rooms;
  }
  /** Holds every receipt at its prepare step, so concurrency is observed rather than inferred. */
  function holdInFlight() {
    const gate = barrier(), full = barrier(), seen = { inside: 0, peak: 0 };
    proof.afterPrepare = async () => {
      seen.inside += 1; seen.peak = Math.max(seen.peak, seen.inside);
      if (seen.inside === 4) full.release();
      await gate.promise;
      seen.inside -= 1;
    };
    return { gate, full, seen };
  }
  /** A notice in the same chat that identifies it by game, because its room owner is unset until publication. */
  async function notice(gameId: string, attemptedAt: Date, kind: "change_cancelled" | "started" = "change_cancelled") {
    const proposalId = randomUUID(), eventId = gameChatLifecycleEventId(gameId, kind, proposalId);
    events.push(eventId);
    await reserveGameChatLifecycleTx({ gameId, kind, proposalId, now, tx: db });
    await db.hostedLinqDelivery.update({ where: { id: (await receipt(eventId)).id }, data: { attemptedAt } });
    return eventId;
  }
  const untouched = async (eventId: string, attemptedAt: Date) => expect(await receipt(eventId)).toMatchObject({ status: "awaiting_generation", attemptedAt });

  it("selects exactly the due lifecycle receipts", async () => {
    const before = new Date(now.getTime() - 1), after = new Date(now.getTime() + 1);
    const cases = [
      ["awaiting, no retry time", true, { retryAfterAt: null }],
      ["awaiting, past", true, { retryAfterAt: before }],
      ["awaiting, exactly now", true, { retryAfterAt: now }],
      ["awaiting, future", false, { retryAfterAt: after }],
      ["queued, no retry time", false, { status: "generation_queued", retryAfterAt: null }],
      ["queued, past", true, { status: "generation_queued", retryAfterAt: before }],
      ["queued, exactly now", true, { status: "generation_queued", retryAfterAt: now }],
      ["queued, future", false, { status: "generation_queued", retryAfterAt: after }],
      ["skipped", false, { status: "skipped" }],
      ["sent", false, { status: "sent" }],
      ["template this build cannot process", false, { template: "game_from_a_newer_build" }],
      ["no source reference", false, { sourceRef: null }],
      ["another source", false, { source: "hosted_runtime_linq_delivery" }],
    ] as const;
    // Each row is its own chat, so only the due filter can exclude it.
    const rows = cases.map(([name, due, override], index) => ({ name, due, row: { id: `selection_${randomUUID()}`, source: "game_lifecycle", status: "awaiting_generation",
      template: "game_group_missed", sourceRef: `selection_room_${randomUUID()}:${date}`, attemptedAt: new Date(index), ...override } }));
    await db.hostedLinqDelivery.createMany({ data: rows.map(({ row }) => row) });
    try {
      const selected = new Set((await readOldestReceiptPerChat(db, now)).map(receipt => receipt.id));
      expect(rows.map(({ name, row }) => [name, selected.has(row.id)])).toEqual(rows.map(({ name, due }) => [name, due]));
    } finally { await db.hostedLinqDelivery.deleteMany({ where: { id: { in: rows.map(({ row }) => row.id) } } }); }
  });

  it("publishes ten rooms in one pass and leaves the eleventh for the next", async () => {
    const rooms = await dueRooms(11);
    expect(await drainGameChatLifecycle({ now })).toMatchObject({ attempted: 10, queued: 10 });
    for (const room of rooms.slice(0, 10)) expect((await receipt(room.eventId)).status).toBe("generation_queued");
    await untouched(rooms[10]!.eventId, new Date(10_000));
    await drainGameChatLifecycle({ now });
    expect((await receipt(rooms[10]!.eventId)).status).toBe("generation_queued");
  });

  it("never has more than four receipts in flight", async () => {
    await dueRooms(10);
    const { gate, full, seen } = holdInFlight();
    const draining = drainGameChatLifecycle({ now });
    await full.promise;
    // A fifth worker would arrive during this wait; a correct cap cannot.
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(seen).toEqual({ inside: 4, peak: 4 });
    gate.release();
    expect(await draining).toMatchObject({ attempted: 10, queued: 10 });
    expect(seen.peak).toBe(4);
  });

  it.each(["check-in", "notice"] as const)("gives a chat one receipt per pass across templates, the older %s first", async older => {
    const [room] = await dueRooms(1), { id, eventId: checkIn } = room!;
    const noticeAt = new Date(older === "notice" ? -1_000 : 1_000), later = older === "notice" ? checkIn : await notice(id, noticeAt);
    const first = older === "notice" ? await notice(id, noticeAt) : checkIn;
    await drainGameChatLifecycle({ now });
    expect((await receipt(first)).attemptedAt).toEqual(now);
    await untouched(later, older === "notice" ? new Date(0) : noticeAt);
    const next = new Date(now.getTime() + 60_000);
    await drainGameChatLifecycle({ now: next });
    expect((await receipt(later)).attemptedAt).toEqual(next);
  });

  it("treats every receipt with no known chat as one chat", async () => {
    const [a, b] = await dueRooms(2);
    await db.game.updateMany({ where: { id: { in: [a!.id, b!.id] } }, data: { chatContainerMemberId: null } });
    await db.hostedLinqDelivery.deleteMany({ where: { idempotencyKey: { in: [a!, b!].map(room => createHostedLinqDeliveryIdempotencyLookupKey(room.eventId)!) } } });
    const [older, newer] = [await notice(a!.id, new Date(1_000), "started"), await notice(b!.id, new Date(2_000), "started")];
    await drainGameChatLifecycle({ now });
    expect((await receipt(older)).attemptedAt).toEqual(now);
    await untouched(newer, new Date(2_000));
  });

  it("publishes another room's check-in behind more older cancellations in one chat than any scan window", async () => {
    const [spammedRoom, freshRoom] = await shardRooms(2, 17);
    const spammed = await fixture(2, spammedRoom), fresh = await fixture(2, freshRoom), spammedGame = await spammed.addGame();
    expect(await reserveGroupGameMissedDay(fresh.roomId, [await fresh.addGame()], now)).toBe(1);
    // What repeated propose-and-cancel builds: one distinct receipt per cancellation, all older than the other room's.
    const prefix = `cancelled_${randomUUID()}_`;
    await db.$executeRaw`INSERT INTO hosted_linq_delivery (id, source, source_ref, template, status, target_kind, attempted_at, updated_at)
      SELECT ${prefix} || n, 'game_lifecycle', ${spammedGame} || ':proposal' || n, 'game_change_cancelled', 'awaiting_generation', 'thread',
        TIMESTAMP '1970-01-01' + n * INTERVAL '1 millisecond', CURRENT_TIMESTAMP FROM generate_series(1, 100121) AS n`;
    try {
      await drainGameChatLifecycle({ now });
      expect(await db.hostedLinqDelivery.findMany({ where: { id: { startsWith: prefix }, attemptedAt: now }, select: { id: true } })).toEqual([{ id: `${prefix}1` }]);
      expect((await receipt(gameGroupMissedDayEventId(fresh.roomId, date))).status).toBe("generation_queued");
      expect(await db.hostedMailboxItem.count({ where: { userId: fresh.roomId } })).toBe(1);
    } finally { await db.hostedLinqDelivery.deleteMany({ where: { id: { startsWith: prefix } } }); }
  });

  it("keeps the batch full behind one busy chat", async () => {
    const [busy, ...others] = await dueRooms(4);
    const backlog = [];
    for (let index = 0; index < 12; index += 1) backlog.push(await notice(busy!.id, new Date(index + 1)));
    expect(await drainGameChatLifecycle({ now })).toMatchObject({ attempted: 4, queued: 4 });
    expect((await receipt(busy!.eventId)).status).toBe("generation_queued");
    for (const room of others) expect((await receipt(room.eventId)).status).toBe("generation_queued");
    for (const [index, eventId] of backlog.entries()) await untouched(eventId, new Date(index + 1));
  });

  it.each([["one second short of", 89_000, 6], ["exactly at", 90_000, 4]] as const)("%s the claim budget, in-flight receipts finish and the rest stay unclaimed", async (_side, elapsed, published) => {
    const rooms = await dueRooms(6);
    const { gate, full } = holdInFlight();
    let clock = 1_000_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const draining = drainGameChatLifecycle({ now });
    await full.promise;
    clock += elapsed; gate.release();
    expect(await draining).toMatchObject({ attempted: published, queued: published });
    for (const [index, room] of rooms.entries()) {
      if (index < published) expect((await receipt(room.eventId)).status).toBe("generation_queued");
      else await untouched(room.eventId, new Date(index * 1_000));
    }
  });

  it("counts time spent in the sweep against the claim budget", async () => {
    const [room] = await dueRooms(1);
    let clock = 1_000_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    vi.spyOn(await import("@/src/lib/game/service"), "reserveDueGameMissedDayCheckIns").mockImplementation(async () => { clock += 90_000; return 0; });
    expect(await drainGameChatLifecycle({ now })).toMatchObject({ attempted: 0 });
    await untouched(room!.eventId, new Date(0));
  });

  it("keeps one receipt's failure away from its siblings", async () => {
    const rooms = await dueRooms(5);
    proof.chatFailures.set(rooms[2]!.f.roomId, new Error("Synthetic provider failure."));
    expect(await drainGameChatLifecycle({ now })).toMatchObject({ attempted: 5, queued: 4, deferred: 1 });
    for (const [index, room] of rooms.entries()) expect((await receipt(room.eventId)).status).toBe(index === 2 ? "awaiting_generation" : "generation_queued");
  });

  it("claims nothing new once the request aborts, and lets in-flight receipts finish", async () => {
    const rooms = await dueRooms(6), controller = new AbortController();
    const { gate, full } = holdInFlight();
    const draining = drainGameChatLifecycle({ now, signal: controller.signal });
    await full.promise;
    controller.abort(); gate.release();
    expect(await draining).toMatchObject({ attempted: 4, queued: 4 });
    for (const [index, room] of rooms.slice(4).entries()) await untouched(room.eventId, new Date((index + 4) * 1_000));
  });

  it("keeps a late claim leased against a later overlapping drain", async () => {
    const rooms = await dueRooms(5), late = rooms[4]!;
    const firstFour = barrier(), released = barrier(), fifth = barrier(), finish = barrier(), prepared = vi.fn();
    let clock = 1_000_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    proof.afterPrepare = async () => {
      prepared();
      const arrival = prepared.mock.calls.length;
      if (arrival === 4) firstFour.release();
      if (arrival <= 4) await released.promise;
      if (arrival === 5) { fifth.release(); await finish.promise; }
    };
    const first = drainGameChatLifecycle({ now });
    await firstFour.promise;
    clock += 65_000; released.release();
    await fifth.promise;
    expect((await receipt(late.eventId)).retryAfterAt).toEqual(new Date(now.getTime() + 65_000 + 180_000));
    await drainGameChatLifecycle({ now: new Date(now.getTime() + 66_000) });
    finish.release();
    await first;
    expect(prepared).toHaveBeenCalledTimes(5);
    expect(await db.hostedMailboxItem.count({ where: { userId: late.f.roomId } })).toBe(1);
  });

  it("retries a failing receipt when its lease ends, not sooner", async () => {
    const [room] = await dueRooms(1);
    proof.rooms.set(room!.f.roomId, [room!.f.people[0]!.email]);
    let clock = now.getTime();
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    await drainGameChatLifecycle({ now });
    const nextTurn = async (seconds: number) => {
      clock = now.getTime() + seconds * 1_000;
      await drainGameChatLifecycle({ now: new Date(clock) });
      return (await receipt(room!.eventId)).attemptedAt;
    };
    expect(await nextTurn(179)).toEqual(now);
    expect(await nextTurn(180)).toEqual(new Date(now.getTime() + 180_000));
  });

  it.each([
    ["an unexpected defect", "TypeError", (f: Fixture) => { proof.chatFailures.set(f.roomId, new TypeError(`Synthetic detail about ${f.roomId}.`)); }],
    ["a provider failure", "LINQ_SEND_FAILED", (f: Fixture) => { proof.chatFailures.set(f.roomId, hostedOnboardingError({ code: "LINQ_SEND_FAILED", httpStatus: 502, message: `Synthetic detail about ${f.roomId}.`, retryable: true })); }],
    ["an unsendable room", "participants_changed", (f: Fixture) => { proof.rooms.set(f.roomId, [f.people[0]!.email]); }],
  ] as const)("logs one fixed-code diagnostic for %s and keeps its siblings going", async (_cause, reason, breakRoom) => {
    const rooms = await dueRooms(3), failed = rooms[1]!;
    breakRoom(failed.f);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await drainGameChatLifecycle({ now })).toMatchObject({ attempted: 3, queued: 2, deferred: 1 });
    expect(info.mock.calls.filter(call => (call[1] as { diagnostic?: string } | undefined)?.diagnostic === "game.chat-lifecycle-item"))
      .toEqual([[expect.any(String), { diagnostic: "game.chat-lifecycle-item", kind: "item_failed", template: "game_group_missed", reason }]]);
    const logged = JSON.stringify(info.mock.calls);
    for (const value of [failed.f.roomId, failed.eventId, ...failed.f.people.flatMap(person => [person.id, person.email])]) expect(logged).not.toContain(value);
  });

  it("never lets overlapping drains publish one receipt twice", async () => {
    const rooms = await dueRooms(10), prepared = vi.fn();
    proof.afterPrepare = async () => { prepared(); };
    await Promise.all([drainGameChatLifecycle({ now }), drainGameChatLifecycle({ now }), drainGameChatLifecycle({ now })]);
    expect(prepared).toHaveBeenCalledTimes(10);
    for (const room of rooms) expect(await db.hostedMailboxItem.count({ where: { userId: room.f.roomId } })).toBe(1);
  });

  it("publishes two rooms that share their members in one pass", async () => {
    const [firstRoom, secondRoom] = await shardRooms(2, 17);
    const first = await fixture(2, firstRoom), second = await fixture(2, secondRoom, first.people);
    expect(await reserveGroupGameMissedDay(first.roomId, [await first.addGame()], now)).toBe(1);
    expect(await reserveGroupGameMissedDay(second.roomId, [await second.addGame()], now)).toBe(1);
    for (const f of [first, second]) await db.hostedLinqDelivery.update({ where: { id: (await receipt(gameGroupMissedDayEventId(f.roomId, date))).id }, data: { attemptedAt: new Date(0) } });
    expect(await drainGameChatLifecycle({ now })).toMatchObject({ attempted: 2, queued: 2 });
    for (const f of [first, second]) expect(await db.hostedMailboxItem.count({ where: { userId: f.roomId } })).toBe(1);
  });
});
