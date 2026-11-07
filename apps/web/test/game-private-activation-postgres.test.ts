import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ eligible: true }));
vi.mock("@/src/lib/game/service", async original => ({
  ...await original<typeof import("@/src/lib/game/service")>(), canTextGameReminders: async () => m.eligible,
}));
import { getPrisma } from "@/src/lib/prisma";
import { sealGameText } from "@/src/lib/game/crypto";
import { activatePrivateGamePlayers, isPrivateKickoffCurrentTx, privateKickoffEventId, reconcilePrivateGameActivations } from "@/src/lib/game/private-kickoff";
import { readMyGameReminderProjection } from "@/src/lib/game/direct-tool";
import { runGameCommand } from "@/src/lib/game/service";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import { cleanupGameFixtures } from "./support/game-fixture-cleanup";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test(?:_[a-z0-9_]+)?$/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Private game proof needs a loopback test database.");
const db = getPrisma();
const now = new Date("2026-11-06T18:00:00Z");
const members: string[] = [];

async function member(firstName: string) {
  const id = `hbm_game_private_${randomUUID()}`;
  members.push(id);
  await db.hostedMember.create({ data: { id } });
  expect(await runGameCommand({ actorMemberId: id, command: { type: "setProfile", firstName, timeZone: "UTC" } })).toMatchObject({ ok: true });
  return id;
}

async function game(people: string[], options: { previousGameId?: string; schedule?: { days: number[] } | { count: number }; lengthDays?: number; startedAt?: Date } = {}) {
  const id = `game_${randomUUID().replaceAll("-", "")}`;
  const words = { v: 1, versions: [{ n: 1, defaultTask: "Walk", tasks: people.map((_, seat) => ({ seat, text: `Task ${seat}` })), stakes: [] }] };
  const encrypted = await sealGameText({ field: "terms_words", memberId: people[0]!, rowId: id, table: "game" }, JSON.stringify(words));
  await db.game.create({ data: { id, createdBy: people[0], wordsOwnerMemberId: people[0]!, status: "live", maxPlayers: people.length > 2 ? 10 : 2,
    ...(options.previousGameId ? { previousGameId: options.previousGameId } : {}), lengthDays: options.lengthDays ?? 7,
    startedAt: options.startedAt ?? now, terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: options.schedule ?? { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [] }] },
    termsWordsEncrypted: encrypted!, players: { create: people.map((memberId, seat) => ({ memberId, seat, timeZone: "UTC", dayOne: new Date("2026-11-06T00:00:00Z"), joinedAt: now })) } } });
  return id;
}

async function kind(gameId: string, memberId: string) {
  const row = await db.gameEvent.findUnique({ where: { commandKey: `game-reminder-activation:${gameId}:${memberId}` }, select: { payload: true } });
  return row?.payload;
}
async function receipt(gameId: string, memberId: string) {
  return db.hostedLinqDelivery.findUnique({ where: { idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(privateKickoffEventId(gameId, memberId))! } });
}

describe.skipIf(!enabled)("private game activation PostgreSQL", () => {
  beforeEach(() => {
    m.eligible = true;
    vi.stubEnv("MURPH_GAME_PRIVATE_REMINDERS_ENABLED", "true");
    vi.stubEnv("MURPH_GAME_ENABLED", "true");
    vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", "");
  });
  afterEach(async () => {
    await cleanupGameFixtures(db, members);
    await db.hostedMember.deleteMany({ where: { id: { in: members.splice(0) } } });
    vi.unstubAllEnvs();
  });

  it("copies by member id from lineage, keeps independent rematch chains, and stays silent on the same rhythm", async () => {
    const a = await member("Alex"), b = await member("Sam");
    const first = await game([a, b], { startedAt: new Date("2026-11-05T18:00:00Z") });
    await db.gamePlayer.update({ where: { gameId_memberId: { gameId: first, memberId: b } }, data: { reminderOff: true, reminderEveryDay: true } });
    const competing = await game([a, b], { startedAt: new Date("2026-11-06T18:30:00Z"), schedule: { count: 3 } });
    const second = await game([b, a], { previousGameId: first });
    await activatePrivateGamePlayers(second, now);
    expect(await kind(second, b)).toEqual({ messageKind: "none" });
    expect(await receipt(second, b)).toBeNull();
    expect(await db.gamePlayer.findUniqueOrThrow({ where: { gameId_memberId: { gameId: second, memberId: b } } }))
      .toMatchObject({ reminderOff: true, reminderEveryDay: true });
    await activatePrivateGamePlayers(second, now);
    expect(await db.gameEvent.count({ where: { gameId: second, type: "reminder_activation" } })).toBe(2);
    const fallback = await game([a, b], { startedAt: new Date("2026-11-06T19:00:00Z"), schedule: { count: 3 } });
    await db.gamePlayer.update({ where: { gameId_memberId: { gameId: competing, memberId: a } }, data: { reminderOff: true } });
    await activatePrivateGamePlayers(fallback, new Date("2026-11-06T19:00:00Z"));
    expect(await db.gamePlayer.findUniqueOrThrow({ where: { gameId_memberId: { gameId: fallback, memberId: a } } })).toMatchObject({ reminderOff: true });
    expect(await kind(fallback, a)).toEqual({ messageKind: "none" });
  });

  it("offers a new person once and a familiar person a new rhythm, then recovers a late join", async () => {
    const a = await member("Alex"), b = await member("Sam"), c = await member("Riley");
    const prior = await game([a, b], { startedAt: new Date("2026-11-05T18:00:00Z") });
    const changed = await game([a, b], { previousGameId: prior, schedule: { count: 3 } });
    await activatePrivateGamePlayers(changed, now);
    expect(await kind(changed, a)).toEqual({ messageKind: "new_rhythm" });
    expect(await receipt(changed, a)).toMatchObject({ template: "game_private_kickoff", payloadOwnerMemberId: a });
    const group = await game([a, b, c], { startedAt: new Date("2026-11-06T17:00:00Z") });
    await db.gamePlayer.update({ where: { gameId_memberId: { gameId: group, memberId: c } }, data: { leftAt: now } });
    await activatePrivateGamePlayers(group, now);
    expect(await kind(group, c)).toBeUndefined();
    await db.gamePlayer.update({ where: { gameId_memberId: { gameId: group, memberId: c } }, data: { leftAt: null } });
    await reconcilePrivateGameActivations(now);
    expect(await kind(group, c)).toEqual({ messageKind: "new_person" });
    expect(await receipt(group, c)).toMatchObject({ template: "game_private_kickoff", payloadOwnerMemberId: c });
    await activatePrivateGamePlayers(group, now);
    expect(await db.gameEvent.count({ where: { gameId: group, type: "reminder_activation", actor: "system" } })).toBe(3);
  });

  it("holds an overnight offer until 09:00 local and does not create expired offers", async () => {
    const a = await member("Alex"), b = await member("Sam");
    const late = new Date("2026-11-06T22:00:00Z");
    const first = await game([a, b], { startedAt: late });
    await activatePrivateGamePlayers(first, late);
    expect((await receipt(first, a))?.retryAfterAt).toEqual(new Date("2026-11-07T09:00:00Z"));
    const old = await game([a, b], { startedAt: new Date("2026-11-04T18:00:00Z"), schedule: { count: 3 } });
    await activatePrivateGamePlayers(old, now);
    expect(await receipt(old, a)).toBeNull();
    const c = await member("Riley");
    await db.gameProfile.update({ where: { memberId: c }, data: { timeZone: "Invalid/Zone" } });
    const invalidZone = await game([a, c], { startedAt: late });
    await activatePrivateGamePlayers(invalidZone, late);
    expect(await receipt(invalidZone, c)).toBeNull();
  });

  it("projects only the requesting member's task and own status", async () => {
    const a = await member("Alex"), b = await member("Sam");
    const id = await game([a, b]);
    const projection = await readMyGameReminderProjection(a);
    expect(projection?.games).toEqual([{ id, task: "Task 0", schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, today: "open",
      otherFirstNames: ["Sam"], on: true, everyDay: false }]);
    expect(JSON.stringify(projection)).not.toContain("Task 1");
    expect(JSON.stringify(projection)).not.toContain(b);
  });

  it("rejects a kickoff after access, seat, live state or expiry changes", async () => {
    const a = await member("Alex"), b = await member("Sam");
    const id = await game([a, b]);
    const policy = { kind: "game_private_kickoff" as const, eventId: privateKickoffEventId(id, a), gameId: id, memberId: a,
      messageKind: "new_person" as const, expiresAt: "2026-11-07T18:00:00.000Z" };
    const current = () => db.$transaction(tx => isPrivateKickoffCurrentTx(policy, tx, now));
    expect(await current()).toBe(true);
    m.eligible = false;
    expect(await current()).toBe(false);
    m.eligible = true;
    await db.gamePlayer.update({ where: { gameId_memberId: { gameId: id, memberId: a } }, data: { leftAt: now } });
    expect(await current()).toBe(false);
    await db.gamePlayer.update({ where: { gameId_memberId: { gameId: id, memberId: a } }, data: { leftAt: null } });
    await db.game.update({ where: { id }, data: { status: "settled" } });
    expect(await current()).toBe(false);
    expect(await db.$transaction(tx => isPrivateKickoffCurrentTx(policy, tx, new Date(policy.expiresAt)))).toBe(false);
  });
});
