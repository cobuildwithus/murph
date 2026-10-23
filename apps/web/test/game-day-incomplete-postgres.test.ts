import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getPrisma } from "@/src/lib/prisma";
import { devSettleNow, readGame, runGameCommand } from "@/src/lib/game/service";
import { addDays, gameLocalDate } from "@/src/lib/game/time";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Day correction proof needs an isolated local test database.");
const members: string[] = [];
async function setup() {
  const db = getPrisma();
  const a = randomUUID(), b = randomUUID(), room = randomUUID(), gameId = randomUUID();
  members.push(a, b, room);
  await db.hostedMember.createMany({ data: [a, b, room].map((id) => ({ id, billingStatus: "active" })) });
  for (const [id, firstName] of [[a, "Maya"], [b, "Sam"]]) {
    expect((await runGameCommand({ actorMemberId: id, command: { type: "setProfile", firstName, timeZone: "UTC" } })).ok).toBe(true);
  }
  const created = await runGameCommand({ actorMemberId: a, command: { type: "createGame", gameId, inviteeFirstName: "Sam", terms: { tasks: [{ seat: 0, text: "Read" }, { seat: 1, text: "Walk" }], schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [{ kind: "prize", item: "Choose a film" }] } } });
  if (!created.ok || !created.game?.inviteToken) throw new Error("Fixture create failed");
  expect((await runGameCommand({ actorMemberId: b, command: { type: "join", token: created.game.inviteToken, termsVersion: 1, timeZone: "UTC" } })).ok).toBe(true);
  const today = gameLocalDate(new Date(), "UTC"), yesterday = addDays(today, -1);
  await db.game.update({ where: { id: gameId }, data: { chatContainerMemberId: room } });
  await db.gamePlayer.updateMany({ where: { gameId }, data: { dayOne: new Date(`${yesterday}T00:00:00Z`) } });
  const post = async (actor = a, date = yesterday) => {
    const entryId = randomUUID();
    const result = await runGameCommand({ actorMemberId: actor, now: new Date(`${date}T12:00:00Z`), command: { type: "post", gameId, entryId, kind: "words", text: "A chapter", mediaKeys: [] } });
    expect(result.ok).toBe(true);
    return entryId;
  };
  const correct = (incomplete = true, date = yesterday, actor = a, chat = room, extra = {}) => runGameCommand({ actorMemberId: actor, chatContainerMemberId: chat, chatPlayerMemberIds: [a, b], command: { type: "setDayCompletion", gameId, date, incomplete, ...extra } });
  return { a, b, room, gameId, today, yesterday, post, correct };
}

describe.skipIf(!enabled)("self-reported game days against PostgreSQL", () => {
  afterAll(async () => { await getPrisma().hostedMember.deleteMany({ where: { id: { in: members } } }); });

  it("marks only the speaker's own post, preserves visibility, and is idempotent under concurrent retries", async () => {
    const f = await setup(), db = getPrisma();
    const own = await f.post(), other = await f.post(f.b);
    const results = await Promise.all([f.correct(), f.correct()]);
    expect(results.map((r) => r.ok && r.dayOutcome?.status).sort()).toEqual(["already_incomplete", "marked_incomplete"]);
    expect(await db.gameEntry.findUniqueOrThrow({ where: { id: own } })).toMatchObject({ incomplete: true, withdrawnAt: null });
    expect(await db.gameEntry.findUniqueOrThrow({ where: { id: other } })).toMatchObject({ incomplete: null });
    expect(await db.gameEvent.findMany({ where: { gameId: f.gameId, type: "day_marked_incomplete" }, select: { actor: true, payload: true } })).toEqual([{ actor: f.a, payload: { v: 1, dayIndex: 0 } }]);
    const mine = await readGame(f.gameId, f.a), partner = await readGame(f.gameId, f.b);
    expect(mine?.days[0].mine).toMatchObject({ entryId: own, incomplete: true, text: "A chapter" });
    expect(partner?.days[0].others[0].entry).toMatchObject({ entryId: own, incomplete: true });
    expect(mine?.players.find((p) => p.isMe)).toMatchObject({ score: 0, streak: 0 });
    expect((await f.correct(true, f.yesterday, f.a, f.room, { memberId: f.b })).ok).toBe(false);
    expect((await f.correct(true, f.yesterday, f.a, f.room, { entryId: other })).ok).toBe(false);
    expect((await db.gameEntry.findUniqueOrThrow({ where: { id: other } })).incomplete).toBeNull();
  });

  it("restores only a self-marked artifact and does not invent completion or events", async () => {
    const f = await setup(), db = getPrisma();
    expect(await f.correct(false)).toMatchObject({ ok: true, dayOutcome: { status: "no_artifact" } });
    expect(await f.correct()).toMatchObject({ ok: true, dayOutcome: { status: "no_artifact" } });
    await f.post();
    expect(await f.correct(false)).toMatchObject({ ok: true, dayOutcome: { status: "already_complete" } });
    await f.correct();
    expect(await f.correct(false, f.yesterday, f.b)).toMatchObject({ ok: true, dayOutcome: { status: "no_artifact" } });
    expect(await f.correct(false)).toMatchObject({ ok: true, dayOutcome: { status: "restored" } });
    expect(await f.correct(false)).toMatchObject({ ok: true, dayOutcome: { status: "already_complete" } });
    expect(await db.gameEvent.count({ where: { gameId: f.gameId, type: { in: ["day_marked_incomplete", "day_restored"] } } })).toBe(2);
    expect((await readGame(f.gameId, f.a))?.days[0].mine).not.toHaveProperty("incomplete");
    expect((await readGame(f.gameId, f.a))?.players.find((p) => p.isMe)?.score).toBe(1);
  });

  it("refuses future, pre-game, unbound, outsider and settled mutations", async () => {
    const f = await setup();
    await f.post();
    for (const date of [addDays(f.today, 1), addDays(f.yesterday, -1)]) expect(await f.correct(true, date)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(await f.correct(true, f.yesterday, f.a, f.b)).toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });
    expect(await f.correct(true, f.yesterday, f.room)).toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });
    expect(await runGameCommand({ actorMemberId: f.a, command: { type: "setDayCompletion", gameId: f.gameId, date: f.yesterday, incomplete: true } })).toMatchObject({ ok: false });
    await devSettleNow(f.gameId, f.a);
    expect(await f.correct()).toMatchObject({ ok: false, error: { code: "GAME_NOT_LIVE" } });
    expect(await f.correct(false)).toMatchObject({ ok: false, error: { code: "GAME_NOT_LIVE" } });
  });

  it("preserves today's flag through a retake and freezes the corrected settlement", async () => {
    const f = await setup();
    await f.post(f.a, f.today); await f.post(f.b, f.today);
    await f.correct(true, f.today);
    const retake = await f.post(f.a, f.today);
    expect((await getPrisma().gameEntry.findUniqueOrThrow({ where: { id: retake } })).incomplete).toBe(true);
    const recap = await devSettleNow(f.gameId, f.a);
    expect(recap.players.find((p) => p.isMe)?.score).toBe(0);
    expect(recap.days[1].mine).toMatchObject({ entryId: retake, incomplete: true });
    expect(recap.tickets).toHaveLength(1);
  });
});
