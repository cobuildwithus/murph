import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/hosted-execution/runtime-owner", () => ({ requireHostedRuntimeCallbackTx: async () => {} }));
vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({ requireHostedRuntimeActiveAccessForUpdateTx: async () => {} }));
vi.mock("@/src/lib/hosted-mailbox/store", async original => ({
  ...await original<typeof import("@/src/lib/hosted-mailbox/store")>(),
  readHostedMailboxConversationWakeByAssistantInputId: async ({ memberId }: { memberId: string }) => ({ kind: "conversation.message", userId: memberId,
    message: { channel: "linq", linqMessage: { isFromMe: false, threadIsDirect: true, chatId: "direct-synthetic" } } }),
}));
vi.mock("@/src/lib/hosted-routing/assistant-notification-destination", async original => ({
  ...await original<typeof import("@/src/lib/hosted-routing/assistant-notification-destination")>(),
  assertHostedDirectAssistantNotificationRouteAuthority: async () => {},
}));

import { getPrisma } from "@/src/lib/prisma";
import { sealGameText } from "@/src/lib/game/crypto";
import { handleMyGameRemindersTool } from "@/src/lib/game/direct-tool";
import { readGameReminders, runGameChatUpdate, runGameCommand } from "@/src/lib/game/service";
import { cleanupGameFixtures } from "./support/game-fixture-cleanup";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test(?:_[a-z0-9_]+)?$/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Reminder time proof needs a loopback test database.");
const db = getPrisma(), members: string[] = [];

async function member() {
  const id = `hbm_reminder_time_${randomUUID()}`;
  members.push(id);
  await db.hostedMember.create({ data: { id, billingStatus: "not_started" } });
  await runGameCommand({ actorMemberId: id, command: { type: "setProfile", firstName: "Player", timeZone: "UTC" } });
  return id;
}
async function game(owner: string, task: string, room?: string) {
  const id = `game_${randomUUID().replaceAll("-", "")}`;
  const words = { v: 1, versions: [{ n: 1, defaultTask: task, tasks: [{ seat: 0, text: task }], stakes: [] }] };
  const encrypted = await sealGameText({ field: "terms_words", memberId: owner, rowId: id, table: "game" }, JSON.stringify(words));
  // Home and game reads use the database clock, so the game starts on the real today.
  const today = new Date(new Date().toISOString().slice(0, 10));
  await db.game.create({ data: { id, createdBy: owner, wordsOwnerMemberId: owner, status: "live", startedAt: today, ...(room ? { chatContainerMemberId: room } : {}),
    terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [] }] }, termsWordsEncrypted: encrypted!,
    players: { create: [{ memberId: owner, seat: 0, timeZone: "UTC", dayOne: today, joinedAt: today }] } } });
  return id;
}
const own = async (gameId: string, memberId: string) =>
  (await db.gamePlayer.findUniqueOrThrow({ where: { gameId_memberId: { gameId, memberId } } })).reminderMinutes;
const direct = (memberId: string, change: { minutes?: number; gameId?: string }) => handleMyGameRemindersTool({ memberId, runtimeIdentity: null,
  request: { action: "my_game_reminders", operation: "set", origin: { kind: "accepted_input", assistantInputId: "input-synthetic" }, ...change } });
const inRoom = (actorMemberId: string, room: string, update: { minutes?: number; gameId?: string }) => runGameChatUpdate({ actorMemberId,
  chatContainerMemberId: room, chatPlayerMemberIds: [actorMemberId], beforeMutationTx: async () => {}, update: { operation: "set_reminder", ...update } });

describe.skipIf(!enabled)("per-game reminder times PostgreSQL", () => {
  beforeEach(() => {
    vi.stubEnv("MURPH_GAME_ENABLED", "true");
    vi.stubEnv("MURPH_GAME_PRIVATE_REMINDERS_ENABLED", "true");
  });
  afterEach(async () => {
    await cleanupGameFixtures(db, members);
    await db.hostedMember.deleteMany({ where: { id: { in: members.splice(0) } } });
    vi.unstubAllEnvs();
  });

  it("reads a selected reminder beyond the first twenty live seats", async () => {
    const owner = await member();
    const ids = [];
    for (let i = 0; i < 21; i++) ids.push(await game(owner, "Read"));
    const gameId = ids.sort().at(-1)!;
    const readPage = (after?: string) => handleMyGameRemindersTool({ memberId: owner, runtimeIdentity: null,
      request: { action: "my_game_reminders", operation: "read", after, origin: { kind: "accepted_input", assistantInputId: "input-synthetic" } } });
    const first = await readPage();
    expect(first.result.reminders?.games).toHaveLength(20);
    expect(first.result.reminders?.nextAfter).toBe(ids[19]);
    const last = await readPage(first.result.reminders?.nextAfter);
    expect(last.result.reminders?.games.map(game => game.id)).toEqual([gameId]);
    const response = await direct(owner, { gameId, minutes: 900 });
    expect(response.result).toMatchObject({ status: "ok", reminders: { games: expect.arrayContaining([
      expect.objectContaining({ id: gameId, minutes: 900 }),
    ]) } });
  });

  it("moves only the named game from the direct chat, and every game without one", async () => {
    const owner = await member(), pullups = await game(owner, "20 pullups"), lifts = await game(owner, "3 lifts");
    const saved = await direct(owner, { gameId: pullups, minutes: 1260 });
    expect(saved).toMatchObject({ result: { status: "ok", reminders: { minutes: 1140 } } });
    const games = "reminders" in saved.result ? saved.result.reminders?.games : undefined;
    expect(Object.fromEntries((games ?? []).map(game => [game.task, game.minutes]))).toEqual({ "20 pullups": 1260, "3 lifts": 1140 });
    expect([await own(pullups, owner), await own(lifts, owner)]).toEqual([1260, null]);
    await direct(owner, { minutes: 1080 });
    expect([await own(pullups, owner), await own(lifts, owner)]).toEqual([null, null]);
    expect((await readGameReminders(owner)).minutes).toBe(1080);
  });

  it("keeps newer channel and mute choices when a room time edit is delayed", async () => {
    const owner = await member(), room = await member();
    const selected = await game(owner, "Stretch", room), other = await game(owner, "Swim");
    const result = await runGameChatUpdate({ actorMemberId: owner, chatContainerMemberId: room,
      chatPlayerMemberIds: [owner], update: { operation: "set_reminder", minutes: 480 },
      beforeMutationTx: async () => {
        await runGameCommand({ actorMemberId: owner, command: { type: "setReminders", push: false,
          text: false, minutes: 1140, offGameIds: [other], everyDayGameIds: [other] } });
      } });
    expect(result).toMatchObject({ ok: true, reminders: { push: false, offGameIds: [other] } });
    expect(await own(selected, owner)).toBe(480);
    expect(await db.gamePlayer.findUniqueOrThrow({ where: { gameId_memberId: { gameId: other, memberId: owner } } }))
      .toMatchObject({ reminderEveryDay: true });
  });

  it("keeps both of two concurrent single-game changes and never writes back the default", async () => {
    const owner = await member(), pullups = await game(owner, "20 pullups"), lifts = await game(owner, "3 lifts");
    await Promise.all([direct(owner, { gameId: pullups, minutes: 1260 }), direct(owner, { gameId: lifts, minutes: 420 }),
      db.gameProfile.update({ where: { memberId: owner }, data: { reminderMinutes: 1000 } })]);
    expect([await own(pullups, owner), await own(lifts, owner)]).toEqual([1260, 420]);
    expect((await readGameReminders(owner)).minutes).toBe(1000);
  });

  it("sets a time in a group chat for that chat's games only, never the default or another chat's game", async () => {
    const owner = await member(), room = await member(), elsewhere = await member(), empty = await member();
    const here = await game(owner, "Walk", room), there = await game(owner, "Read", elsewhere), solo = await game(owner, "Run");
    expect(await inRoom(owner, room, { minutes: 720 })).toMatchObject({ ok: true });
    expect([await own(here, owner), await own(there, owner), await own(solo, owner)]).toEqual([720, null, null]);
    expect((await readGameReminders(owner)).minutes).toBe(1140);
    await db.gamePlayer.update({ where: { gameId_memberId: { gameId: there, memberId: owner } }, data: { reminderMinutes: 600 } });
    expect(await inRoom(owner, room, { minutes: 750 })).toMatchObject({ ok: true });
    expect([await own(here, owner), await own(there, owner)]).toEqual([750, 600]);
    expect(await inRoom(owner, empty, { minutes: 900 })).toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });
    expect([await own(here, owner), await own(there, owner), await own(solo, owner)]).toEqual([750, 600, null]);
  });
});
