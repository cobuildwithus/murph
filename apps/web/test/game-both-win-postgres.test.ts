import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../src/lib/prisma";
import { runGameCommand } from "../src/lib/game/service";
import { drainGameChatLifecycle } from "../src/lib/game/chat-lifecycle";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "../src/lib/hosted-onboarding/linq-observability-identifiers";
import { cleanupGameFixtures } from "./support/game-fixture-cleanup";
import * as time from "../src/lib/game/time";
import type { GameCommand } from "../src/lib/game/contract";

const effects = vi.hoisted(() => ({ publish: vi.fn(), signal: vi.fn(), push: vi.fn(), discover: vi.fn(), bootstrap: vi.fn() }));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: () => {} }));
vi.mock("../src/lib/game/service", async original => ({ ...await original<typeof import("../src/lib/game/service")>(), reserveDueGameMissedDayCheckIns: async () => 0 }));
vi.mock("../src/lib/game/evening-check-in", async original => ({ ...await original<typeof import("../src/lib/game/evening-check-in")>(), reserveDueGameEveningCheckIns: async () => 0 }));
vi.mock("../src/lib/game/private-notification", async original => ({ ...await original<typeof import("../src/lib/game/private-notification")>(), reserveDuePrivateEveningCheckIns: async () => 0 }));
vi.mock("../src/lib/game/private-kickoff", async original => ({ ...await original<typeof import("../src/lib/game/private-kickoff")>(), reconcilePrivateGameActivations: async () => 0, activatePrivateGamePlayers: async () => {} }));
vi.mock("../src/lib/game/reminder-notification", () => ({ sendDueGameReminders: async () => {} }));
vi.mock("../src/lib/game/post-notification", () => ({ claimGamePostNotification: effects.push, sendGamePostNotificationAfterResponse: () => {} }));
vi.mock("../src/lib/game/chat-membership", async original => ({ ...await original<typeof import("../src/lib/game/chat-membership")>(),
  readGameChatAuthority: async (game: { players: { memberId: string }[] }) => ({ memberIds: game.players.map(player => player.memberId) }),
  readGroupGameNoticeAuthority: async (game: { players: { memberId: string }[] }) => ({ memberIds: game.players.map(player => player.memberId) }),
  findExistingGameChat: effects.discover }));
vi.mock("../src/lib/game/chat-bootstrap", () => ({ prepareGameChatBootstrap: effects.bootstrap, reconcileFrozenGameChatBootstrapReceipt: async () => false }));
vi.mock("../src/lib/hosted-mailbox/store", async original => ({ ...await original<typeof import("../src/lib/hosted-mailbox/store")>(),
  readHostedMailboxItemByDedupeKey: async () => null, prepareHostedMailboxEnvelopeAppend: effects.publish,
  appendPreparedHostedMailboxEnvelopeTx: async () => ({ mailboxItemId: "both_win_notice" }) }));
vi.mock("../src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedMailboxAppendRuntime: effects.signal }));
vi.mock("../src/lib/hosted-routing/assistant-notification-destination", () => ({
  resolveHostedAssistantNotificationDestination: async () => ({ conversationShape: "thread-container", route: { channel: "linq" } }),
  bindHostedAssistantNotificationDestination: () => ({ route: { channel: "linq", delivery: { kind: "thread", target: "both-win-chat" }, accountId: "synthetic-line" } }),
  assertHostedAssistantNotificationRouteAuthority: async () => {},
}));
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Both-win proof needs an isolated local test database.");
const members: string[] = [];
const at = (date: string) => new Date(date);
async function fixture(lengthDays = 7, zones = ["UTC", "UTC"]) {
  const [ava, leo, room] = [randomUUID(), randomUUID(), randomUUID()]; members.push(ava, leo, room);
  await getPrisma().hostedMember.createMany({ data: [ava, leo, room].map(id => ({ id, billingStatus: "not_started" })) });
  for (const [seat, actorMemberId] of [ava, leo].entries()) await runGameCommand({ actorMemberId, command: { type: "setProfile", firstName: seat ? "Leo" : "Ava", timeZone: zones[seat] } });
  const gameId = randomUUID();
  const created = await runGameCommand({ actorMemberId: ava, command: { type: "createGame", gameId, inviteeFirstName: "Leo",
    terms: { lengthDays, tasks: [{ seat: 0, text: "Read" }, { seat: 1, text: "Walk" }], schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [{ kind: "prize", item: "Choose lunch" }] } } });
  if (!created.ok) throw new Error(`Fixture create failed: ${created.error.code}`);
  if (!created.game?.inviteToken) throw new Error("Fixture invite token is missing");
  expect(await runGameCommand({ actorMemberId: leo, command: { type: "join", token: created.game.inviteToken, termsVersion: 1, timeZone: zones[1] } })).toMatchObject({ ok: true });
  await getPrisma().game.update({ where: { id: gameId }, data: { chatContainerMemberId: room } });
  await getPrisma().gamePlayer.updateMany({ where: { gameId }, data: { dayOne: at("2030-04-01T00:00:00Z") } });
  const completed = Math.ceil(2 * lengthDays / 3);
  await getPrisma().gameEntry.createMany({ data: [ava, leo].flatMap(memberId => Array.from({ length: completed - (memberId === ava ? 1 : 0) }, (_, dayIndex) => ({
    id: randomUUID(), gameId, memberId, dayIndex, attempt: 1, kind: "words", mediaKeys: [], receivedAt: at("2030-04-01T14:00:00Z"),
  }))) });
  await getPrisma().hostedLinqDelivery.deleteMany({ where: { source: "game_lifecycle", sourceRef: gameId } });
  const run = (command: GameCommand, now: Date) => runGameCommand({ actorMemberId: ava, command, now, chatContainerMemberId: room,
    chatPlayerMemberIds: [ava, leo], beforeMutationTx: async () => {} });
  const complete = (now: Date) => runGameCommand({ actorMemberId: ava, now, command: { type: "post", gameId, entryId: randomUUID(), kind: "words", text: "Read today", mediaKeys: [] } });
  const receipt = () => getPrisma().hostedLinqDelivery.findUnique({ where: { idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(`game-both-win:${gameId}`)! } });
  return { ava, leo, room, gameId, run, complete, receipt, completed };
}

describe.skipIf(!enabled)("both-win completion and held delivery against PostgreSQL", () => {
  beforeEach(async () => { await cleanupGameFixtures(getPrisma(), members); vi.clearAllMocks(); effects.push.mockResolvedValue([]); effects.publish.mockResolvedValue({}); });
  afterAll(async () => { await cleanupGameFixtures(getPrisma(), members); await getPrisma().hostedMember.deleteMany({ where: { id: { in: members } } }); });

  it.each([false, true])("qualifies at 10pm and holds until 9am; a closed miss skips forever: %s", async missed => {
    const game = await fixture();
    expect(await game.complete(at("2030-04-05T22:00:00Z"))).toMatchObject({ ok: true });
    expect(await game.receipt()).toMatchObject({ sourceRef: game.gameId, template: "game_both_win", status: "awaiting_generation", retryAfterAt: at("2030-04-06T09:00:00Z") });
    if (missed) expect(await game.run({ type: "setDayCompletion", gameId: game.gameId, date: "2030-04-05", incomplete: true }, at("2030-04-05T22:30:00Z"))).toMatchObject({ ok: true });
    await drainGameChatLifecycle({ now: at("2030-04-06T08:59:59Z") });
    expect(effects.publish).not.toHaveBeenCalled(); expect(effects.signal).not.toHaveBeenCalled();
    await drainGameChatLifecycle({ now: at("2030-04-06T09:00:00Z") });
    expect(effects.publish).toHaveBeenCalledTimes(missed ? 0 : 1); expect(effects.signal).toHaveBeenCalledTimes(missed ? 0 : 1);
    expect(await game.receipt()).toMatchObject({ status: missed ? "skipped" : "generation_queued" });
    if (missed) {
      expect(await game.receipt()).toMatchObject({ skippedAt: at("2030-04-06T09:00:00Z"), retryAfterAt: null });
      expect(await game.run({ type: "setDayCompletion", gameId: game.gameId, date: "2030-04-05", incomplete: false }, at("2030-04-06T10:00:00Z"))).toMatchObject({ ok: true });
      expect(await game.receipt()).toMatchObject({ status: "skipped" });
      await drainGameChatLifecycle({ now: at("2030-04-06T10:00:00Z") });
      expect(effects.publish).not.toHaveBeenCalled(); expect(effects.signal).not.toHaveBeenCalled();
    }
    expect(effects.discover).not.toHaveBeenCalled(); expect(effects.bootstrap).not.toHaveBeenCalled();
  });
  it.each([
    { zones: ["UTC", "UTC"], now: "2030-04-05T14:00:00Z", held: "2030-04-05T14:00:00Z" },
    { zones: ["America/New_York", "Europe/London"], now: "2030-04-06T02:00:00Z", held: "2030-04-06T13:00:00Z" },
  ])("holds at the latest player morning: %j", async ({ zones, now, held }) => {
    const game = await fixture(7, zones);
    expect(await game.complete(at(now))).toMatchObject({ ok: true });
    expect(await game.receipt()).toMatchObject({ retryAfterAt: at(held) });
    await drainGameChatLifecycle({ now: at(held) }); expect(effects.publish).toHaveBeenCalledOnce();
  });
  it("offers only earlier prizes from this pair's games in this same chat", async () => {
    const game = await fixture();
    const other = randomUUID(); members.push(other);
    await getPrisma().hostedMember.create({ data: { id: other, billingStatus: "not_started" } });
    // Three finished games between the same two players: here, in another chat, and in no chat.
    for (const [item, chatContainerMemberId] of [["Same room prize", game.room], ["Other room prize", other], ["Unbound prize", null]] as const) {
      const gameId = randomUUID();
      const created = await runGameCommand({ actorMemberId: game.ava, command: { type: "createGame", gameId, inviteeFirstName: "Leo",
        terms: { lengthDays: 3, tasks: [{ seat: 0, text: "Read" }, { seat: 1, text: "Walk" }], schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [{ kind: "prize", item }] } } });
      if (!created.ok || !created.game?.inviteToken) throw new Error("Earlier game fixture failed");
      expect(await runGameCommand({ actorMemberId: game.leo, command: { type: "join", token: created.game.inviteToken, termsVersion: 1, timeZone: "UTC" } })).toMatchObject({ ok: true });
      await getPrisma().game.update({ where: { id: gameId }, data: { status: "settled", settledAt: at("2030-03-20T00:00:00Z"), chatContainerMemberId,
        result: { v: 1, termsVersion: 1, scores: [{ seat: 0, memberId: game.ava, score: 3, misses: 0 }, { seat: 1, memberId: game.leo, score: 2, misses: 1 }] } } });
      await getPrisma().hostedLinqDelivery.deleteMany({ where: { source: "game_lifecycle", sourceRef: gameId } });
    }
    expect(await game.complete(at("2030-04-05T14:00:00Z"))).toMatchObject({ ok: true });
    await drainGameChatLifecycle({ now: at("2030-04-05T14:00:00Z") });
    expect(effects.publish).toHaveBeenCalledOnce();
    const instructions: string = effects.publish.mock.calls[0][0].envelope.notification.instructions;
    const data = JSON.parse(instructions.split("\n").at(-1)!);
    expect(data).toMatchObject({ currentPrize: "Choose lunch", earlierPrizes: ["Same room prize"] });
    expect(instructions).not.toMatch(/Other room prize|Unbound prize/u);
  });
  it("uses now for a null morning result", async () => {
    const game = await fixture();
    const morning = vi.spyOn(time, "morningAfter").mockReturnValue(null);
    try { expect(await game.complete(at("2030-04-05T22:00:00Z"))).toMatchObject({ ok: true }); }
    finally { morning.mockRestore(); }
    expect(await game.receipt()).toMatchObject({ retryAfterAt: at("2030-04-05T22:00:00Z") });
    await drainGameChatLifecycle({ now: at("2030-04-05T22:00:00Z") });
    expect(effects.publish).toHaveBeenCalledOnce();
  });
  it.each(["credit", "restore"] as const)("reserves once from %s, including the four-day restore case, without a push", async operation => {
    const game = await fixture(operation === "restore" ? 4 : 7);
    const date = operation === "restore" ? "2030-04-03" : "2030-04-05";
    const now = at(operation === "restore" ? "2030-04-03T14:00:00Z" : "2030-04-06T14:00:00Z");
    if (operation === "restore") await getPrisma().gameEntry.create({ data: { id: randomUUID(), gameId: game.gameId, memberId: game.ava,
      dayIndex: 2, attempt: 1, kind: "words", mediaKeys: [], receivedAt: now, incomplete: true } });
    const command = { type: "setDayCompletion" as const, gameId: game.gameId, date, incomplete: false,
      ...(operation === "credit" ? { credit: true as const, text: "Read that day" } : {}) };
    expect(await game.run(command, now)).toMatchObject({ ok: true });
    const first = await game.receipt(); expect(first).not.toBeNull();
    expect(await game.run(command, now)).toMatchObject({ ok: true });
    expect(await game.receipt()).toEqual(first); expect(effects.push).not.toHaveBeenCalled();
  });
  it("a block skips the held game receipt and never discovers or creates a chat", async () => {
    const game = await fixture();
    expect(await game.complete(at("2030-04-05T22:00:00Z"))).toMatchObject({ ok: true });
    expect(await game.run({ type: "block", memberId: game.leo }, at("2030-04-05T22:30:00Z"))).toMatchObject({ ok: true });
    expect(await game.receipt()).toMatchObject({ status: "skipped", sourceRef: game.gameId });
    await drainGameChatLifecycle({ now: at("2030-04-06T09:00:00Z") });
    expect(effects.publish).not.toHaveBeenCalled(); expect(effects.signal).not.toHaveBeenCalled();
    expect(effects.discover).not.toHaveBeenCalled(); expect(effects.bootstrap).not.toHaveBeenCalled();
  });
  it.each(["pending", "unbound", "incomplete"])("does not reserve from a post when %s", async obstacle => {
    const game = await fixture();
    if (obstacle === "pending") await getPrisma().game.update({ where: { id: game.gameId }, data: { pendingChange: { v: 2, id: "pending", proposedByMemberId: game.leo,
      expectedTermsVersion: 1, effectiveFromDay: 5, startsOn: null, deliveryStatus: "conversation", origin: "chat", change: { kind: "edit", lengthDays: 10 } } } });
    if (obstacle === "unbound") await getPrisma().game.update({ where: { id: game.gameId }, data: { chatContainerMemberId: null } });
    if (obstacle === "incomplete") await getPrisma().gameEntry.create({ data: { id: randomUUID(), gameId: game.gameId, memberId: game.ava,
      dayIndex: 4, attempt: 1, kind: "words", mediaKeys: [], receivedAt: at("2030-04-05T12:00:00Z"), incomplete: true } });
    expect(await game.complete(at("2030-04-05T14:00:00Z"))).toMatchObject({ ok: true });
    expect(await game.receipt()).toBeNull();
    if (obstacle === "incomplete") expect(effects.push).not.toHaveBeenCalled();
  });
  it("one reserved post survives repeat posts and later credit or restore without a second receipt", async () => {
    const game = await fixture(); const now = at("2030-04-05T14:00:00Z");
    expect(await game.complete(now)).toMatchObject({ ok: true }); const first = await game.receipt();
    expect(await game.complete(now)).toMatchObject({ ok: true });
    expect(await game.run({ type: "setDayCompletion", gameId: game.gameId, date: "2030-04-05", incomplete: true }, now)).toMatchObject({ ok: true });
    expect(await game.run({ type: "setDayCompletion", gameId: game.gameId, date: "2030-04-05", incomplete: false }, now)).toMatchObject({ ok: true });
    expect(await game.receipt()).toEqual(first);
    await getPrisma().gameEntry.deleteMany({ where: { gameId: game.gameId, memberId: game.ava, dayIndex: 3 } });
    expect(await game.run({ type: "setDayCompletion", gameId: game.gameId, date: "2030-04-04", incomplete: false, credit: true, text: "Read that day" }, now)).toMatchObject({ ok: true });
    expect(await game.receipt()).toEqual(first);
    expect(await getPrisma().hostedLinqDelivery.count({ where: { sourceRef: game.gameId, template: "game_both_win" } })).toBe(1);
  });
});
