import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../src/lib/prisma";
import { handleGameChatPhoto } from "../src/lib/game/chat-photo";
import { buildHostedLinqConversationWakeForMailbox } from "../src/lib/hosted-onboarding/webhook-provider-linq";
import { readGameChatState, runGameCommand } from "../src/lib/game/service";
import { mediaKeyPrefixFor } from "../src/lib/game/access";
import { addDays, gameLocalDate } from "../src/lib/game/time";
vi.mock("../src/lib/game/chat-delivery", () => ({ deliverGameChangeProposal: async () => {} }));
const imageControl = vi.hoisted(() => ({ putGameImage: vi.fn(async () => {}), statGameImage: vi.fn(async () => ({ byteLength: 3 })) }));
vi.mock("../src/lib/hosted-execution/control", () => ({ readHostedExecutionControlClientIfConfigured: () => imageControl }));
const photoProvider = vi.hoisted(() => ({ metadata: vi.fn() }));
vi.mock("../src/lib/hosted-onboarding/linq-client", async (original) => ({ ...await original<typeof import("../src/lib/hosted-onboarding/linq-client")>(), readHostedLinqAttachment: photoProvider.metadata }));
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Game progress proof requires an isolated local test database.");
const members: string[] = [];
async function fixture() {
  const a = `progress_a_${randomUUID()}`, b = `progress_b_${randomUUID()}`, room = `progress_room_${randomUUID()}`;
  members.push(a,b,room);
  const db = getPrisma();
  await db.hostedMember.createMany({ data: [a,b,room].map((id) => ({ id, billingStatus: "not_started" })) });
  for (const [memberId, firstName] of [[a,"Alex"],[b,"Sam"]]) await runGameCommand({ actorMemberId: memberId, command: { type: "setProfile", firstName, timeZone: "UTC" } });
  const gameId = randomUUID();
  const created = await runGameCommand({ actorMemberId: a, command: { type: "createGame", gameId, inviteeFirstName: "Private contact label", terms: { tasks: [{ seat: 0, text: "Read" }, { seat: 1, text: "Read" }], schedule: { days: [0,1,2,3,4,5,6] }, stakes: [{ kind: "winner_gets", item: "Choose a book" }] } } });
  if (!created.ok || !created.game?.inviteToken) throw new Error("Fixture creation failed");
  const joined = await runGameCommand({ actorMemberId: b, command: { type: "join", token: created.game.inviteToken, termsVersion: 1, timeZone: "UTC" } });
  if (!joined.ok) throw new Error("Fixture join failed");
  await db.game.update({ where: { id: gameId }, data: { chatContainerMemberId: room } });
  return { a,b,room,gameId,db };
}
describe.skipIf(!enabled)("shared game progress canonical PostgreSQL proof", () => {
  beforeEach(() => { vi.stubEnv("VERCEL_ENV", "preview"); imageControl.putGameImage.mockClear(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  afterAll(async () => { await getPrisma().hostedMember.deleteMany({ where: { id: { in: members } } }); });
  it("settles on the shared read and returns frozen scores and grouped tickets exactly once", async () => {
    const {a,b,room,gameId,db} = await fixture();
    const dayOne = addDays(gameLocalDate(new Date(), "UTC"), -8);
    await db.gamePlayer.updateMany({ where: { gameId }, data: { dayOne: new Date(`${dayOne}T00:00:00Z`) } });
    await db.gameEntry.create({ data: { id: randomUUID(), gameId, memberId: a, dayIndex: 0, attempt: 1, kind: "photo", mediaKeys: ["private-photo"], receivedAt: new Date() } });
    const first = await readGameChatState("alternate-room", [a,b], a);
    expect(first.games[0]).toMatchObject({ status: "settled", result: { scores: [{ memberId: a, score: 1, misses: 6 }, { memberId: b, score: 0, misses: 7 }], tickets: [{ owedByMemberId: b, owedToMemberId: a, what: "Choose a book", status: "open", count: 1 }] } });
    expect(JSON.stringify(first)).not.toMatch(/private-photo|Private contact label|inviteToken|mediaKeys/);
    expect((await readGameChatState(room,[a,b])).games[0].result).toEqual(first.games[0].result);
    expect(await db.gameEvent.count({ where: { gameId, type: "settled" } })).toBe(1);
    expect(await db.gameTicket.count({ where: { gameId } })).toBe(1);
  });
  it("guards replacement inside the posting transaction and deduplicates retries", async () => {
    const {a,b,room,gameId,db} = await fixture();
    const dayOne = gameLocalDate(new Date(), "UTC");
    await db.gamePlayer.updateMany({ where: { gameId }, data: { dayOne: new Date(`${dayOne}T00:00:00Z`) } });
    const mediaKeys = [`${mediaKeyPrefixFor(a)}${"a".repeat(64)}.jpg`];
    const firstId = randomUUID(), secondId = randomUUID();
    const post = (entryId: string, replacement: string | null) => runGameCommand({ actorMemberId: a, chatContainerMemberId: "alternate-room", chatPlayerMemberIds: [a,b], beforeMutationTx: async () => {}, postGuard: { dayIndex: 0, replaceEntryId: replacement }, command: { type: "post", gameId, entryId, kind: "photo", mediaKeys } });
    const denied = await runGameCommand({ actorMemberId: a, chatContainerMemberId: "alternate-room", chatPlayerMemberIds: [a, "former_player"], beforeMutationTx: async () => {}, command: { type: "post", gameId, entryId: firstId, kind: "photo", mediaKeys } });
    expect(denied).toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });
    expect(await post(firstId,null)).toMatchObject({ ok: true });
    expect(await post(secondId,null)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(await db.gameEntry.count({ where: { gameId } })).toBe(1);
    expect(await post(secondId,firstId)).toMatchObject({ ok: true });
    expect(await post(secondId,firstId)).toMatchObject({ ok: true });
    expect(await db.gameEntry.count({ where: { gameId } })).toBe(2);
    expect((await db.game.findUniqueOrThrow({ where: { id: gameId } })).chatContainerMemberId).toBe(room);
    const progress = (await readGameChatState(room,[a,b],a)).games[0].progress;
    expect(progress?.players.find((player) => player.memberId === a)).toMatchObject({ score: 1, currentEntryId: secondId, attemptsRemaining: 0 });
  });
  it("saves the offered attachment from a second room through the normal post and does not repeat the introduction", async () => {
    const { a,b,room,gameId,db } = await fixture();
    const now = new Date();
    const dayOne = gameLocalDate(now, "UTC");
    await db.gamePlayer.updateMany({ where: { gameId }, data: { dayOne: new Date(`${dayOne}T00:00:00Z`) } });
    const sourceRef = `ain_${randomUUID()}`, yesRef = `ain_${randomUUID()}`;
    const alternateRoom = `secondary_${randomUUID()}`;
    const wake = buildHostedLinqConversationWakeForMailbox({ eventId: "synthetic-photo-event", occurredAt: now.toISOString(), userId: alternateRoom,
      routeAuthority: { channel: "linq", accountLookupKey: "synthetic-line-key", containerMemberId: alternateRoom, threadId: "synthetic-chat" },
      senderMemberId: a, participantContact: { kind: "phone", lookupKey: "synthetic-phone-key" },
      linqMessage: { chatId: "synthetic-chat", from: "+15555550101", isFromMe: false, messageId: "synthetic-message", threadIsDirect: false },
      rawParts: [{ type: "media", attachment_id: "synthetic-attachment", mime_type: "image/jpeg", url: "https://cdn.linqapp.com/expired?signature=synthetic" }] });
    const yesWake = buildHostedLinqConversationWakeForMailbox({ eventId: "synthetic-yes-event", occurredAt: now.toISOString(), userId: alternateRoom,
      routeAuthority: { channel: "linq", accountLookupKey: "synthetic-line-key", containerMemberId: alternateRoom, threadId: "synthetic-chat" },
      senderMemberId: a, participantContact: { kind: "phone", lookupKey: "synthetic-phone-key" },
      linqMessage: { chatId: "synthetic-chat", from: "+15555550101", isFromMe: false, messageId: "synthetic-yes", threadIsDirect: false }, rawParts: [{ type: "text", value: "Yes" }] });
    // Exercise the production webhook-to-mailbox normalizer: signed URLs never survive acceptance.
    expect(wake.message.linqMessage.parts).toEqual([{ type: "media", attachmentId: "synthetic-attachment", mimeType: "image/jpeg" }]);
    expect(JSON.stringify(wake)).not.toContain("signature");
    const common = { actor: a, containerMemberId: alternateRoom, playerMemberIds: [a,b], authorize: async (_tx: unknown, ref: string) => ({ actor: a, wake: ref === sourceRef ? wake : yesWake }) };
    photoProvider.metadata.mockReset().mockResolvedValue({ id: "synthetic-attachment", content_type: "image/jpeg", size_bytes: 3, download_url: "https://cdn.linqapp.com/refreshed?signature=synthetic" });
    const download = vi.fn(async () => new Response(new Uint8Array([255,216,255])));
    vi.stubGlobal("fetch", download);
    const offered = await handleGameChatPhoto({ ...common, messageRef: sourceRef, photo: { operation: "offer", gameId, sourceMessageRef: sourceRef, attachmentOrdinal: 1 } });
    expect(offered).toEqual({ status: "ok", photoOutcome: "offer" });
    expect(await db.gameEntry.count({ where: { gameId } })).toBe(0);
    expect(photoProvider.metadata).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    expect(imageControl.putGameImage).not.toHaveBeenCalled();
    const yes = { ...common, messageRef: yesRef, photo: { operation: "save" as const, gameId } };
    expect(await handleGameChatPhoto({ ...yes, containerMemberId: room })).toMatchObject({ error: "photo_offer_expired" });
    expect(await handleGameChatPhoto(yes)).toEqual({ status: "ok", photoOutcome: "saved" });
    expect(await handleGameChatPhoto(yes)).toEqual({ status: "ok", photoOutcome: "saved" });
    expect(photoProvider.metadata).toHaveBeenCalledExactlyOnceWith("synthetic-attachment");
    expect(imageControl.putGameImage).toHaveBeenCalledExactlyOnceWith({ bytes: new Uint8Array([255,216,255]), contentType: "image/jpeg", mediaId: expect.stringMatching(/^[a-f0-9]{64}\.jpg$/u), userId: a });
    expect(download).toHaveBeenCalledExactlyOnceWith("https://cdn.linqapp.com/refreshed?signature=synthetic", expect.objectContaining({ redirect: "error" }));
    expect(await db.gameEntry.count({ where: { gameId } })).toBe(1);
    expect((await db.gameEntry.findFirstOrThrow({ where: { gameId } })).memberId).toBe(a);
    expect((await db.game.findUniqueOrThrow({ where: { id: gameId } })).chatContainerMemberId).toBe(room);
    expect(await handleGameChatPhoto({ ...common, messageRef: sourceRef, photo: { operation: "offer", gameId, sourceMessageRef: sourceRef, attachmentOrdinal: 1 } })).toEqual({ status: "ok", photoOutcome: "suppressed" });
    const shared = await readGameChatState(alternateRoom, [a,b], a);
    expect(shared.photoCheckIn).toEqual({ introductionAvailable: false, hasPendingOffer: false });
    expect(shared.games[0].progress?.players.find((player) => player.memberId === a)).toMatchObject({ score: 1, attemptsRemaining: 1 });
    expect(JSON.stringify(shared)).not.toContain(sourceRef);
  });
});
