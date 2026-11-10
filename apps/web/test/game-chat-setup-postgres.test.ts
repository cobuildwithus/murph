import { readGameChatCandidateIds } from "@/src/lib/game/chat-membership";
import { cleanupGameFixtures } from "./support/game-fixture-cleanup";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "@/src/lib/prisma";
import { readGame, readHome, readGameChatState, runGameChatUpdate, runGameCommand } from "@/src/lib/game/service";
import type { HostedGameUpdate } from "@murphai/hosted-execution/runtime-control";
import { gameLocalDate, addDays } from "@/src/lib/game/time";
vi.mock("@/src/lib/game/chat-delivery", () => ({ deliverGameChangeProposal: vi.fn() }));
vi.mock("@/src/lib/game/chat-lifecycle", () => ({ deliverGameChatLifecycle: vi.fn() }));
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Chat setup proof requires an isolated local test database.");
const members: string[] = [];
async function setup() {
  const a = randomUUID(), b = randomUUID(), room = randomUUID();
  members.push(a, b, room);
  await getPrisma().hostedMember.createMany({ data: [a, b, room].map(id => ({ id, billingStatus: "not_started" })) });
  for (const [id, firstName] of [[a, "Ava"], [b, "Sam"]]) expect(await runGameCommand({ actorMemberId: id, command: { type: "setProfile", firstName, timeZone: "UTC" } })).toMatchObject({ ok: true });
  const create = (gameId = randomUUID(), previousGameId?: string): Extract<HostedGameUpdate, { operation: "create" }> => ({ operation: "create", gameId, ...(previousGameId ? { previousGameId } : {}), terms: {
    // Deliberately reverse input order: references, never ordering, own the tasks.
    tasks: [{ memberId: b, text: "Read a chapter" }, { memberId: a, text: "Walk twenty minutes" }],
    schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [{ kind: "prize", item: "Choose the film" }],
  } });
  const run = (actorMemberId: string, update: HostedGameUpdate, now?: Date) => runGameChatUpdate({ actorMemberId, update, chatContainerMemberId: room, chatPlayerMemberIds: [a, b], beforeMutationTx: async () => {}, ...(now ? { now } : {}) });
  return { a, b, room, create, run };
}
async function appRematch(f: Awaited<ReturnType<typeof setup>>) {
  const previous = f.create(); await f.run(f.a, previous);
  await getPrisma().game.update({ where: { id: previous.gameId }, data: { status: "settled" } });
  const id = randomUUID();
  expect(await runGameCommand({ actorMemberId: f.a, command: { type: "createGame", gameId: id, previousGameId: previous.gameId,
    inviteeFirstName: "Sam", terms: { tasks: [{ seat: 0, text: "Walk" }, { seat: 1, text: "Read" }], schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [{ kind: "dare", item: "Sing karaoke" }] } } })).toMatchObject({ ok: true });
  return id;
}
describe.skipIf(!enabled)("chat game setup persistence", () => {
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await cleanupGameFixtures(getPrisma(), members);
    await getPrisma().hostedMember.deleteMany({ where: { id: { in: members } } }); });
  it("shows an addressed app rematch to both players and only its invitee can shake in chat", async () => {
    const f = await setup(), id = await appRematch(f);
    for (const actor of [f.a, f.b]) expect((await readGameChatState(f.room, [f.a, f.b], actor)).games.find(g => g.id === id)).toMatchObject({ status: "invited", players: [{ memberId: f.a, seat: 0, dayOne: null }] });
    expect(await f.run(f.a, { operation: "approve", gameId: id, expectedTermsVersion: 1 })).toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });
    expect(await f.run(f.b, { operation: "cancel_game", gameId: id })).toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });
    expect((await readGame(id, f.a))?.status).toBe("invited");
    expect(await f.run(f.b, { operation: "approve", gameId: id, expectedTermsVersion: 1 })).toMatchObject({ ok: true });
    expect(await readGame(id, f.b)).toMatchObject({ status: "live", players: [{ seat: 0 }, { seat: 1, isMe: true }] });
    expect(await getPrisma().gameEvent.count({ where: { gameId: id, type: "started" } })).toBe(1);
    expect(await getPrisma().hostedLinqDelivery.count({ where: { sourceRef: id, template: "game_started" } })).toBe(1);
  });
  it("maps a rematch counter to app negotiation without a duplicate proposal notice", async () => {
    const f = await setup(), id = await appRematch(f), proposalId = randomUUID();
    expect(await f.run(f.b, { operation: "propose", gameId: id, proposalId, expectedTermsVersion: 1, change: { kind: "edit", lengthDays: 30 } })).toMatchObject({ ok: true });
    expect(await readGame(id, f.b)).toMatchObject({ status: "negotiating", pendingChange: { id: proposalId, proposedByMemberId: f.b, origin: "chat", deliveryStatus: "conversation" } });
    expect(await getPrisma().hostedLinqDelivery.count({ where: { sourceRef: id, template: "game_change_proposed" } })).toBe(0);
    expect(await f.run(f.a, { operation: "approve", gameId: id, proposalId })).toMatchObject({ ok: true });
    expect(await readGame(id, f.a)).toMatchObject({ status: "live", lengthDays: 30 });
  });
  it("refuses wrong-pair and bearer-link approval, and hides expired or blocked rematches", async () => {
    const f = await setup(), id = await appRematch(f), other = await setup();
    expect(await other.run(other.b, { operation: "approve", gameId: id, expectedTermsVersion: 1 })).toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });
    await getPrisma().game.update({ where: { id }, data: { previousGameId: null, invitees: { deleteMany: {} } } });
    expect(await f.run(f.b, { operation: "approve", gameId: id, expectedTermsVersion: 1 })).toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });
    expect((await readGameChatState(f.room, [f.a, f.b])).games.map(g => g.id)).not.toContain(id);
    const expired = await appRematch(f);
    expect(await readGameChatCandidateIds([f.a, f.b, other.a], true, f.room)).toContain(expired);
    await getPrisma().game.update({ where: { id: expired }, data: { inviteExpiresAt: new Date(0) } });
    expect((await readGameChatState(f.room, [f.a, f.b])).games.map(g => g.id)).not.toContain(expired);
    expect(await readGameChatCandidateIds([f.a, f.b, other.a], true, f.room)).not.toContain(expired);
    expect(await f.run(f.b, { operation: "approve", gameId: expired, expectedTermsVersion: 1 })).toMatchObject({ ok: false });
    const blocked = await appRematch(other);
    await runGameCommand({ actorMemberId: other.a, command: { type: "block", memberId: other.b } });
    expect((await readGameChatState(other.room, [other.a, other.b])).games).toEqual([]);
    expect(await other.run(other.b, { operation: "approve", gameId: blocked, expectedTermsVersion: 1 })).toMatchObject({ ok: false });
  });
  it("creates both seats with complete app terms, no obligations, no labels and no duplicate notice", async () => {
    const f = await setup(), create = f.create();
    expect(await runGameChatUpdate({ actorMemberId: f.a, update: create, chatContainerMemberId: f.room, chatPlayerMemberIds: [f.a, f.b] })).toEqual({ ok: true, game: null });
    const mine = await readGame(create.gameId, f.a), theirs = await readGame(create.gameId, f.b);
    for (const game of [mine, theirs]) expect(game).toMatchObject({ status: "negotiating", startedAt: null, lengthDays: 7, startsOn: null, pendingChange: null, days: [], terms: { n: 1, checkInKind: "any", tasks: [{ seat: 0, text: "Walk twenty minutes" }, { seat: 1, text: "Read a chapter" }], stakes: [{ kind: "prize", item: "Choose the film" }] } });
    expect(mine!.players.map(p => [p.seat, p.isMe, p.dayIndex, p.relationship])).toEqual([[0, true, null, null], [1, false, null, null]]);
    expect(theirs!.players.map(p => [p.seat, p.isMe])).toEqual([[0, false], [1, true]]);
    expect(mine!.inviteToken).toEqual(expect.any(String));
    expect(theirs!.inviteToken).toEqual(expect.any(String));
    expect((await readHome(f.a)).games.map(g => g.id)).toContain(create.gameId);
    expect((await readHome(f.b)).games.map(g => g.id)).toContain(create.gameId);
    expect(await getPrisma().hostedLinqDelivery.count({ where: { sourceRef: create.gameId } })).toBe(0);
    expect(await getPrisma().gameContactLabel.count({ where: { ownerMemberId: f.a } })).toBe(0);
    expect((await readGameChatState(f.room, [f.a, f.b], f.a)).games[0]?.players).toEqual(expect.arrayContaining([expect.objectContaining({ memberId: f.a, firstName: "Ava" }), expect.objectContaining({ memberId: f.b, firstName: "Sam" })]));
  });
  it("matches an app negotiating GameView for each seat without a native contract change", async () => {
    const f = await setup(), chat = f.create();
    if (chat.operation !== "create") throw new Error("fixture");
    await f.run(f.a, chat);
    const appId = randomUUID();
    const created = await runGameCommand({ actorMemberId: f.a, command: { type: "createGame", gameId: appId, inviteeFirstName: "Sam", terms: { ...chat.terms, tasks: [{ seat: 0, text: "Walk twenty minutes" }, { seat: 1, text: "Read a chapter" }] } } });
    if (!created.ok || !created.game?.inviteToken) throw new Error("app create");
    const proposalId = randomUUID();
    expect(await runGameCommand({ actorMemberId: f.b, command: { type: "negotiate", token: created.game.inviteToken, termsVersion: 1, timeZone: "UTC", proposalId, change: { kind: "edit", lengthDays: 30 } } })).toMatchObject({ ok: true });
    expect(await f.run(f.a, { operation: "decline", gameId: appId, proposalId })).toMatchObject({ ok: true });
    // IDs, cryptographic tokens and expiry instants differ per creation. Private
    // labels belong only to the app challenger; compare the shared native shape
    // and every other value with that optional label absent on both sides.
    await getPrisma().gameContactLabel.deleteMany({ where: { ownerMemberId: f.a } });
    const normalize = (view: NonNullable<Awaited<ReturnType<typeof readGame>>>) => ({ ...view, id: "game", inviteToken: typeof view.inviteToken, inviteExpiresAt: typeof view.inviteExpiresAt,
      terms: { ...view.terms, stakes: view.terms.stakes.map(stake => ({ ...stake, key: "stake" })) } });
    for (const viewer of [f.a, f.b]) {
      expect(normalize((await readGame(chat.gameId, viewer))!)).toEqual(normalize((await readGame(appId, viewer))!));
    }
  });
  it("agrees through join, uses acceptance time and reserves exactly one durable kickoff", async () => {
    const f = await setup(), create = f.create();
    await f.run(f.a, create);
    expect(await f.run(f.a, { operation: "approve", gameId: create.gameId, expectedTermsVersion: 1 })).toMatchObject({ ok: false });
    const now = new Date(); now.setUTCHours(12, 0, 0, 0);
    const approve = { operation: "approve" as const, gameId: create.gameId, expectedTermsVersion: 1 };
    for (const result of await Promise.all([f.run(f.b, approve, now), f.run(f.b, approve, now)])) expect(result).toMatchObject({ ok: true });
    expect(await readGame(create.gameId, f.b)).toMatchObject({ status: "live", days: [expect.objectContaining({ localDate: gameLocalDate(now, "UTC") }), ...Array.from({ length: 6 }, () => expect.any(Object))] });
    expect(await getPrisma().gameEvent.count({ where: { gameId: create.gameId, type: "started" } })).toBe(1);
    expect(await getPrisma().hostedLinqDelivery.count({ where: { sourceRef: create.gameId, template: "game_started" } })).toBe(1);
  });
  it.each(["creator", "invitee"])("allows %s cancellation and retains a single cancellation notice", async who => {
    const f = await setup(), create = f.create(); await f.run(f.a, create);
    const actor = who === "creator" ? f.a : f.b;
    const cancel = { operation: "cancel_game" as const, gameId: create.gameId };
    expect(await f.run(actor, cancel)).toMatchObject({ ok: true });
    expect(await f.run(actor, cancel)).toMatchObject({ ok: true });
    expect(await readGame(create.gameId, f.a)).toMatchObject({ status: "void" });
    expect(await getPrisma().gameEvent.count({ where: { gameId: create.gameId, type: "cancelled" } })).toBe(1);
    expect(await getPrisma().hostedLinqDelivery.count({ where: { sourceRef: create.gameId, template: "game_cancelled" } })).toBe(1);
  });
  it("counters, declines a change, then accepts exact current terms without starting on a decline", async () => {
    const f = await setup(), create = f.create(); await f.run(f.a, create);
    const proposalId = randomUUID();
    expect(await f.run(f.b, { operation: "propose", gameId: create.gameId, proposalId, expectedTermsVersion: 1, change: { kind: "edit", lengthDays: 30 } })).toMatchObject({ ok: true });
    expect(await f.run(f.b, { operation: "approve", gameId: create.gameId, expectedTermsVersion: 1 })).toMatchObject({ ok: false });
    expect(await f.run(f.a, { operation: "decline", gameId: create.gameId, proposalId })).toMatchObject({ ok: true });
    expect(await readGame(create.gameId, f.b)).toMatchObject({ status: "negotiating", lengthDays: 7, pendingChange: null });
    expect(await f.run(f.b, { operation: "approve", gameId: create.gameId, expectedTermsVersion: 2 })).toMatchObject({ ok: false, error: { code: "TERMS_CHANGED" } });
    expect(await f.run(f.b, { operation: "approve", gameId: create.gameId, expectedTermsVersion: 1 })).toMatchObject({ ok: true });
  });
  it("applies an approved counter through the existing response path", async () => {
    const f = await setup(), create = f.create(); await f.run(f.a, create);
    const proposalId = randomUUID();
    await f.run(f.b, { operation: "propose", gameId: create.gameId, proposalId, expectedTermsVersion: 1, change: { kind: "edit", lengthDays: 30 } });
    expect(await f.run(f.a, { operation: "approve", gameId: create.gameId, proposalId })).toMatchObject({ ok: true });
    expect(await readGame(create.gameId, f.b)).toMatchObject({ status: "live", lengthDays: 30 });
  });
  it("serializes a race at nine and permits an idempotent retry at ten", async () => {
    const f = await setup();
    for (let i = 0; i < 9; i++) expect(await f.run(f.a, f.create())).toMatchObject({ ok: true });
    const first = f.create(), second = f.create();
    const results = await Promise.all([f.run(f.a, first), f.run(f.a, second)]);
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(results.find(r => !r.ok)).toMatchObject({ error: { code: "TOO_MANY_GAMES" } });
    expect(await f.run(f.a, results[0].ok ? first : second)).toMatchObject({ ok: true });
    expect(await getPrisma().game.count({ where: { createdBy: f.a } })).toBe(10);
  });
  it("shares the tenth slot with a simultaneous app invitation acceptance", async () => {
    const f = await setup();
    for (let i = 0; i < 9; i++) await f.run(f.a, f.create());
    const invite = await runGameCommand({ actorMemberId: f.a, command: { type: "createGame", gameId: randomUUID(), inviteeFirstName: "Sam", terms: { tasks: [{ seat: 0, text: "Walk" }, { seat: 1, text: "Read" }], schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [{ kind: "prize", item: "Choose dinner" }] } } });
    if (!invite.ok || !invite.game?.inviteToken) throw new Error("app invite");
    const results = await Promise.all([
      f.run(f.a, f.create()),
      runGameCommand({ actorMemberId: f.b, command: { type: "join", token: invite.game.inviteToken, termsVersion: 1, timeZone: "UTC" } }),
    ]);
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(results.find(r => !r.ok)).toMatchObject({ error: { code: "TOO_MANY_GAMES" } });
    expect(await getPrisma().game.count({ where: { createdBy: f.a, status: { in: ["negotiating", "live"] } } })).toBe(10);
  });
  it("deduplicates concurrent gameId retries and preserves task ownership when the other player creates", async () => {
    const f = await setup(), create = f.create();
    expect((await Promise.all([f.run(f.b, create), f.run(f.b, create)])).every(r => r.ok)).toBe(true);
    expect(await readGame(create.gameId, f.b)).toMatchObject({ terms: { tasks: [{ seat: 0, text: "Read a chapter" }, { seat: 1, text: "Walk twenty minutes" }] } });
    expect(await getPrisma().gameEvent.count({ where: { gameId: create.gameId, type: "created" } })).toBe(1);
    expect(await f.run(f.a, create)).toMatchObject({ ok: false });
  });
  it("checks the chat opponent before revealing an open rematch", async () => {
    const f = await setup(), c = randomUUID(), room = randomUUID();
    members.push(c, room);
    await getPrisma().hostedMember.createMany({ data: [c, room].map(id => ({ id, billingStatus: "not_started" })) });
    expect(await runGameCommand({ actorMemberId: c, command: { type: "setProfile", firstName: "Casey", timeZone: "UTC" } })).toMatchObject({ ok: true });
    const previous = f.create();
    expect(await f.run(f.a, previous)).toMatchObject({ ok: true });
    await getPrisma().game.update({ where: { id: previous.gameId }, data: { status: "settled" } });
    expect(await f.run(f.b, f.create(randomUUID(), previous.gameId))).toMatchObject({ ok: true });
    const create = f.create(randomUUID(), previous.gameId);
    if (create.operation !== "create") throw new Error("fixture");
    const result = await runGameChatUpdate({ actorMemberId: f.a, chatContainerMemberId: room,
      chatPlayerMemberIds: [f.a, c], beforeMutationTx: async () => {}, update: { ...create,
        terms: { ...create.terms, tasks: create.terms.tasks.map(task => ({ ...task, memberId: task.memberId === f.b ? c : task.memberId })) } } });
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER",
      message: "Rematch a settled game with the other person in this chat." } });
    expect(await getPrisma().game.count({ where: { id: create.gameId } })).toBe(0);
    expect(await getPrisma().game.count({ where: { chatContainerMemberId: room } })).toBe(0);
  });
  it("enforces listed creation, the unlisted rematch exception and open/outdated chain rules", async () => {
    const f = await setup(); vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", f.a);
    expect(await f.run(f.b, f.create())).toMatchObject({ ok: false, error: { code: "GAME_DISABLED" } });
    const first = f.create(); await f.run(f.a, first);
    await getPrisma().game.update({ where: { id: first.gameId }, data: { status: "settled" } });
    const rematch = f.create(randomUUID(), first.gameId);
    expect(await f.run(f.b, rematch)).toMatchObject({ ok: true });
    expect(await f.run(f.b, f.create(randomUUID(), first.gameId))).toMatchObject({ ok: false, error: { code: "ALREADY_IN_A_GAME" } });
    // An opposite create must not silently accept unknown final terms.
    expect(await f.run(f.a, f.create(randomUUID(), first.gameId))).toMatchObject({ ok: false, error: { code: "ALREADY_IN_A_GAME" } });
    await getPrisma().game.update({ where: { id: rematch.gameId }, data: { status: "settled" } });
    expect(await f.run(f.b, f.create(randomUUID(), first.gameId))).toMatchObject({ ok: false, error: { code: "REMATCH_OUTDATED" } });
    vi.stubEnv("MURPH_GAME_ENABLED", "false");
    expect(await f.run(f.a, f.create())).toMatchObject({ ok: false, error: { code: "GAME_DISABLED" } });
  });
  it("refuses unknown profiles without inventing data and allows the existing profile setup path", async () => {
    const f = await setup(); await getPrisma().gameProfile.delete({ where: { memberId: f.b } });
    expect(await f.run(f.a, f.create())).toMatchObject({ ok: false, error: { code: "PROFILE_REQUIRED", message: `${f.b} needs a first name and time zone in the Murph app.` } });
    expect(await getPrisma().game.count({ where: { createdBy: f.a } })).toBe(0);
    await runGameCommand({ actorMemberId: f.b, command: { type: "setProfile", firstName: "Sam", timeZone: "UTC" } });
    expect(await f.run(f.a, f.create())).toMatchObject({ ok: true });
  });
  it("uses the same content, duration, date, stake and schedule validation without partial writes", async () => {
    const f = await setup(), create = f.create(); if (create.operation !== "create") throw new Error("fixture");
    const today = gameLocalDate(new Date(), "UTC");
    for (const [terms, code] of [
      [{ ...create.terms, stakes: [{ kind: "prize", item: "$100" }] }, "CONTENT_NOT_ALLOWED"],
      [{ ...create.terms, lengthDays: 366 }, "INVALID_REQUEST"],
      [{ ...create.terms, startsOn: addDays(today, 61) }, "INVALID_REQUEST"],
      [{ ...create.terms, schedule: { count: 8 }, lengthDays: 7 }, "INVALID_REQUEST"],
    ] satisfies Array<[Extract<HostedGameUpdate, { operation: "create" }>["terms"], string]>) expect(await f.run(f.a, { ...create, terms })).toMatchObject({ ok: false, error: { code } });
    expect(await getPrisma().game.count({ where: { createdBy: f.a } })).toBe(0);
  });
});
