import { cleanupGameFixtures } from "./support/game-fixture-cleanup";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrisma } from "@/src/lib/prisma";
import { mediaKeyPrefixFor } from "@/src/lib/game/access";
import { putGameMedia } from "@/src/lib/game/media";
import { readGame, runGameCommand, swapGameChatPhoto } from "@/src/lib/game/service";
import { addDays, gameLocalDate } from "@/src/lib/game/time";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Chat photo swap proof needs an isolated local test database.");
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const members: string[] = [];
let mediaDir = "";

async function setup() {
  const db = getPrisma();
  const a = randomUUID(), b = randomUUID(), room = randomUUID(), gameId = randomUUID();
  members.push(a, b, room);
  await db.hostedMember.createMany({ data: [a, b, room].map((id) => ({ id, billingStatus: "active" })) });
  for (const [id, firstName] of [[a, "Maya"], [b, "Sam"]]) {
    expect((await runGameCommand({ actorMemberId: id, command: { type: "setProfile", firstName, timeZone: "UTC" } })).ok).toBe(true);
  }
  const created = await runGameCommand({ actorMemberId: a, command: { type: "createGame", gameId, inviteeFirstName: "Sam", terms: { tasks: [{ seat: 0, text: "Plank" }, { seat: 1, text: "Walk" }], schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [{ kind: "prize", item: "Choose a film" }] } } });
  if (!created.ok || !created.game?.inviteToken) throw new Error("Fixture create failed");
  expect((await runGameCommand({ actorMemberId: b, command: { type: "join", token: created.game.inviteToken, termsVersion: 1, timeZone: "UTC" } })).ok).toBe(true);
  await db.game.update({ where: { id: gameId }, data: { chatContainerMemberId: room } });
  await db.gamePlayer.updateMany({ where: { gameId }, data: { dayOne: new Date(`${addDays(gameLocalDate(new Date(), "UTC"), -1)}T00:00:00Z`) } });
  const upload = (name: string) => putGameMedia({ bytes: new Uint8Array([...JPEG, ...new TextEncoder().encode(name)]), contentType: "image/jpeg", prefix: mediaKeyPrefixFor(a) });
  const chat = { chatContainerMemberId: room, chatPlayerMemberIds: [a, b] };
  const swap = (entryId: string, mediaKey: string, extra = {}) => swapGameChatPhoto({ actorMemberId: a, ...chat, gameId, entryId, dayIndex: 1, mediaKey, beforeMutationTx: async () => {}, ...extra });
  return { a, b, room, gameId, chat, upload, swap };
}

describe.skipIf(!enabled)("swapping a photo Murph saved from chat, against PostgreSQL", () => {
  beforeAll(async () => {
    mediaDir = await mkdtemp(path.join(process.env.MURPH_VITEST_TEMP_ROOT ?? tmpdir(), "game-media-"));
    process.env.MURPH_GAME_MEDIA_DIR = mediaDir;
  });
  afterAll(async () => {
    await cleanupGameFixtures(getPrisma(), members);
    await getPrisma().hostedMember.deleteMany({ where: { id: { in: members } } });
    delete process.env.MURPH_GAME_MEDIA_DIR;
    await rm(mediaDir, { force: true, recursive: true });
  });

  it("swaps the upload on the same post, drops replies to the old photo, and keeps the retake", async () => {
    const f = await setup(), db = getPrisma();
    const wrong = await f.upload("wrong"), right = await f.upload("right");
    const entryId = `gce_${randomUUID().replaceAll("-", "")}`;
    expect((await runGameCommand({ actorMemberId: f.a, ...f.chat, command: { type: "post", gameId: f.gameId, entryId, kind: "photo", mediaKeys: [wrong] } })).ok).toBe(true);
    await db.gameReply.create({ data: { id: randomUUID(), entryId, authorMemberId: f.b, kind: "text", textEncrypted: "sealed" } });

    expect(await f.swap(entryId, right)).toMatchObject({ ok: true });
    expect(await db.gameEntry.findUniqueOrThrow({ where: { id: entryId } })).toMatchObject({ attempt: 1, dayIndex: 1, kind: "photo", mediaKeys: [right], withdrawnAt: null });
    expect(await db.gameReply.count({ where: { entryId } })).toBe(0);
    expect(await db.gameEvent.findMany({ where: { gameId: f.gameId, type: "photo_swapped" }, select: { actor: true, payload: true } })).toEqual([{ actor: f.a, payload: { v: 1, dayIndex: 1, entryId } }]);
    expect((await readGame(f.gameId, f.a))?.days[1].mine).toMatchObject({ entryId, kind: "photo" });

    // The same swap again changes nothing.
    expect(await f.swap(entryId, right)).toMatchObject({ ok: true });
    expect(await db.gameEvent.count({ where: { gameId: f.gameId, type: "photo_swapped" } })).toBe(1);

    // The app retake is still there, and once it replaces the post, the old entry can't be swapped.
    const retake = randomUUID();
    expect(await runGameCommand({ actorMemberId: f.a, command: { type: "post", gameId: f.gameId, entryId: retake, kind: "photo", mediaKeys: [await f.upload("retake")] } })).toMatchObject({ ok: true });
    expect(await db.gameEntry.findUniqueOrThrow({ where: { id: retake } })).toMatchObject({ attempt: 2 });
    expect(await f.swap(entryId, wrong)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(await db.gameEntry.findUniqueOrThrow({ where: { id: entryId } })).toMatchObject({ mediaKeys: [right] });
  });

  it("refuses another day, another player's upload, and a chat without exactly its players", async () => {
    const f = await setup(), db = getPrisma();
    const first = await f.upload("first"), second = await f.upload("second");
    const entryId = `gce_${randomUUID().replaceAll("-", "")}`;
    expect((await runGameCommand({ actorMemberId: f.a, ...f.chat, command: { type: "post", gameId: f.gameId, entryId, kind: "photo", mediaKeys: [first] } })).ok).toBe(true);
    expect(await f.swap(entryId, second, { dayIndex: 0 })).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    const foreign = await putGameMedia({ bytes: new Uint8Array([...JPEG, 1]), contentType: "image/jpeg", prefix: mediaKeyPrefixFor(f.b) });
    expect(await f.swap(entryId, foreign)).toMatchObject({ ok: false, error: { code: "MEDIA_MISSING" } });
    // A pair game belongs to the chat that holds exactly its two players.
    expect(await f.swap(entryId, second, { chatPlayerMemberIds: [f.a, f.room] })).toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });
    expect(await f.swap(entryId, second, { actorMemberId: f.b })).toMatchObject({ ok: false });
    expect(await db.gameEntry.findUniqueOrThrow({ where: { id: entryId } })).toMatchObject({ mediaKeys: [first] });
  });
});
