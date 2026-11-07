import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ eligible: true }));
vi.mock("@/src/lib/game/service", async original => ({
  ...await original<typeof import("@/src/lib/game/service")>(), canTextGameReminders: async () => m.eligible,
}));
import { getPrisma } from "@/src/lib/prisma";
import { sealGameText } from "@/src/lib/game/crypto";
import { activatePrivateGamePlayers, isPrivateKickoffCurrentTx, privateKickoffEventId, publishPrivateKickoff, reconcilePrivateGameActivations } from "@/src/lib/game/private-kickoff";
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

async function waitForBlocked(holderPid: number, count: number) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const [row] = await db.$queryRaw<Array<{ count: number }>>`WITH RECURSIVE blocked AS (
      SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND ${holderPid} = ANY(pg_blocking_pids(pid))
      UNION SELECT activity.pid FROM pg_stat_activity activity JOIN blocked ON blocked.pid = ANY(pg_blocking_pids(activity.pid))
      WHERE activity.datname = current_database()
    ) SELECT count(*)::int AS count FROM blocked`;
    if (row!.count >= count) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Expected reminder contention was not observed.");
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

  it.each([false, true])("preserves an explicit reminder choice after failed activation (previous off=%s)", async previousOff => {
    const a = await member("Alex"), b = await member("Sam");
    const previous = await game([a, b], { startedAt: new Date("2026-11-05T18:00:00Z") });
    await db.game.update({ where: { id: previous }, data: { status: "settled" } });
    await db.gamePlayer.update({ where: { gameId_memberId: { gameId: previous, memberId: a } },
      data: { reminderOff: previousOff, reminderEveryDay: previousOff } });
    const current = await game([a, b], { previousGameId: previous, schedule: { count: 3 } });
    const failure = vi.spyOn(db, "$transaction").mockRejectedValueOnce(new Error("synthetic activation failure"));
    try {
      await expect(activatePrivateGamePlayers(current, now)).rejects.toThrow("synthetic activation failure");
    } finally { failure.mockRestore(); }
    expect(await kind(current, a)).toBeUndefined();

    const choice = !previousOff;
    expect(await runGameCommand({ actorMemberId: a, command: {
      type: "setReminders", minutes: 1140, push: true, text: false,
      offGameIds: choice ? [current] : [], everyDayGameIds: choice ? [current] : [],
    } })).toMatchObject({ ok: true });
    const seat = () => db.gamePlayer.findUniqueOrThrow({ where: { gameId_memberId: { gameId: current, memberId: a } } });
    expect(await seat()).toMatchObject({ reminderOff: choice, reminderEveryDay: choice });
    await reconcilePrivateGameActivations(now);
    expect(await seat()).toMatchObject({ reminderOff: choice, reminderEveryDay: choice });
    expect(await kind(current, a)).toEqual({ messageKind: "new_rhythm" });
    expect(await receipt(current, a)).toMatchObject({ template: "game_private_kickoff" });
  });

  it("preserves feature-off choices while inheriting the omitted every-day field", async () => {
    const a = await member("Alex"), b = await member("Sam");
    const previous = await game([a, b], { startedAt: new Date("2026-11-05T18:00:00Z") });
    await db.game.update({ where: { id: previous }, data: { status: "settled" } });
    await db.gamePlayer.update({ where: { gameId_memberId: { gameId: previous, memberId: a } }, data: { reminderEveryDay: true } });
    const current = await game([a, b], { previousGameId: previous, schedule: { count: 3 } });
    vi.stubEnv("MURPH_GAME_PRIVATE_REMINDERS_ENABLED", "false");
    expect(await runGameCommand({ actorMemberId: a, command: { type: "setReminders", minutes: 1140,
      push: true, text: false, offGameIds: [current] } })).toMatchObject({ ok: true });
    vi.stubEnv("MURPH_GAME_PRIVATE_REMINDERS_ENABLED", "true");
    await reconcilePrivateGameActivations(now);
    expect(await db.gamePlayer.findUniqueOrThrow({ where: { gameId_memberId: { gameId: current, memberId: a } } }))
      .toMatchObject({ reminderOff: true, reminderEveryDay: true });
    expect(await receipt(current, a)).toMatchObject({ template: "game_private_kickoff" });
  });

  it.each([["activation", false], ["save", false], ["activation", true], ["save", true]] as const)(
    "preserves the explicit choice when %s obtains the game lock first (existing off choice=%s)", async (first, existingOff) => {
    const a = await member("Alex"), b = await member("Sam");
    const previous = await game([a, b], { startedAt: new Date("2026-11-05T18:00:00Z") });
    await db.game.update({ where: { id: previous }, data: { status: "settled" } });
    const current = await game([a, b], { previousGameId: previous, schedule: { count: 3 } });
    if (existingOff) expect(await runGameCommand({ actorMemberId: a, command: { type: "setReminders", minutes: 1140,
      push: true, text: false, offGameIds: [current] } })).toMatchObject({ ok: true });
    const acquired = deferred<number>(), release = deferred<void>();
    const holding = db.$transaction(async tx => {
      const [connection] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      if (first === "activation") await tx.$queryRaw`SELECT id FROM game WHERE id = ${current} FOR UPDATE`;
      else {
        await tx.$queryRaw`SELECT id FROM game WHERE id = ${current} FOR KEY SHARE`;
        await tx.$queryRaw`SELECT game_id FROM game_player WHERE game_id = ${current} AND member_id = ${a} FOR UPDATE`;
      }
      acquired.resolve(connection!.pid);
      await release.promise;
    }, { timeout: 10_000 });
    const activate = () => activatePrivateGamePlayers(current, now);
    const save = () => runGameCommand({ actorMemberId: a, command: { type: "setReminders", minutes: 1140,
      push: true, text: false, offGameIds: existingOff ? [] : [current], everyDayGameIds: [current] } });
    let activation: Promise<void> | undefined, saved: ReturnType<typeof save> | undefined;
    try {
      const pid = await acquired.promise;
      if (first === "activation") activation = activate();
      else saved = save();
      await waitForBlocked(pid, 1);
      if (first === "activation") saved = save();
      else activation = activate();
      await waitForBlocked(pid, 2);
      release.resolve();
      expect(await saved).toMatchObject({ ok: true });
      await activation;
    } finally {
      release.resolve();
      await Promise.allSettled([holding, activation, saved]);
    }
    expect(await db.gamePlayer.findUniqueOrThrow({ where: { gameId_memberId: { gameId: current, memberId: a } } }))
      .toMatchObject({ reminderOff: !existingOff, reminderEveryDay: true });
    expect(await receipt(current, a)).toMatchObject({ template: "game_private_kickoff" });
  });

  it("records at most two facts per seat with constant queries for 1,000 live games", async () => {
    const a = await member("Alex"), b = await member("Sam");
    const first = await game([a, b]);
    vi.stubEnv("MURPH_GAME_PRIVATE_REMINDERS_ENABLED", "false");
    const { runWithPrismaOperationTimings } = await import("@/src/lib/prisma-operation-timing");
    const measure = async (ids: string[]) => {
      const operations: import("@/src/lib/prisma-operation-timing").PrismaOperationTiming[] = [];
      const queries: import("@/src/lib/prisma-operation-timing").PrismaQueryTiming[] = [];
      const acquisitions: import("@/src/lib/prisma-operation-timing").PrismaPoolAcquisitionTiming[] = [];
      const saved = await runWithPrismaOperationTimings(operations, () => runGameCommand({ actorMemberId: a,
        command: { type: "setReminders", minutes: 1140, push: true, text: false, offGameIds: ids, everyDayGameIds: ids },
      }), acquisitions, queries);
      expect(saved).toMatchObject({ ok: true });
      expect(queries.every(query => !query.failed)).toBe(true);
      expect(queries.length).toBeLessThanOrEqual(12);
      expect(acquisitions).toHaveLength(1);
      return { queries: queries.length, operations: operations.length };
    };
    const single = await measure([first]);
    const additional = Array.from({ length: 999 }, () => `game_${randomUUID().replaceAll("-", "")}`);
    await db.game.createMany({ data: additional.map(id => ({ id, createdBy: a, wordsOwnerMemberId: a, status: "live",
      terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { count: 3 }, stakes: [] }] }, termsWordsEncrypted: "unused", startedAt: now })) });
    await db.gamePlayer.createMany({ data: additional.flatMap(gameId => [a, b].map((memberId, seat) => ({
      gameId, memberId, seat, timeZone: "UTC", joinedAt: now,
    }))) });
    const ids = [first, ...additional];
    expect(await measure(ids)).toEqual(single);
    expect(await measure(ids)).toEqual(single);
    expect(await db.gameEvent.count({ where: { actor: a, type: { in: ["reminder_off_chosen", "reminder_every_day_chosen"] } } })).toBe(2_000);
    expect(await db.gamePlayer.count({ where: { memberId: a, reminderOff: true, reminderEveryDay: true } })).toBe(1_000);
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

  it("waits for morning when a queued offer reaches publication after 9pm", async () => {
    const a = await member("Alex"), b = await member("Sam");
    const start = new Date("2026-11-06T20:59:00Z");
    const id = await game([a, b], { startedAt: start });
    await activatePrivateGamePlayers(id, start);
    expect((await receipt(id, a))?.retryAfterAt).toEqual(start);
    expect(await publishPrivateKickoff(id, a, new Date("2026-11-06T21:05:00Z"))).toBe(false);
    expect((await receipt(id, a))?.retryAfterAt).toEqual(new Date("2026-11-07T09:00:00Z"));
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
    vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", "someone-else");
    expect(await current()).toBe(false);
    vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", "");
    await db.game.update({ where: { id }, data: { status: "settled" } });
    expect(await current()).toBe(false);
    expect(await db.$transaction(tx => isPrivateKickoffCurrentTx(policy, tx, new Date(policy.expiresAt)))).toBe(false);
  });
});
