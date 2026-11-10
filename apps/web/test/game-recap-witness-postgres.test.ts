import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GAME_RECAP_GENERATION_RETIRED, type HostedGameRecap } from "@murphai/hosted-execution/runtime-control";
import { handleGameChatTool } from "../src/lib/game/chat-tool";
import { gameRecapMessage } from "../src/lib/game/recap-message";
import { getPrisma } from "../src/lib/prisma";
import { sealGameText } from "../src/lib/game/crypto";
import { readGame, readHistory, readHome, readGameRecapMaterial, runGameCommand, sealGameRecap } from "../src/lib/game/service";
import { runWithPrismaOperationTimings, type PrismaOperationTiming } from "../src/lib/prisma-operation-timing";
import { recordGameRecapWitnessTx } from "../src/lib/game/recap-witness";
import { deliverGameChatLifecycle } from "../src/lib/game/chat-lifecycle";
import { buildHostedExecutionAssistantNotificationRequestedWake } from "@murphai/hosted-execution";
import { appendPreparedHostedMailboxEnvelopeTx, prepareHostedMailboxEnvelopeAppend } from "../src/lib/hosted-mailbox/store";
import { reviewGameReport } from "../src/lib/game/report-review";
import { requestGameRecapRegeneration } from "../src/lib/game/recap-regeneration";
import { assertGameProposalDeliveryCurrentTx } from "../src/lib/game/chat-delivery-authority";
import { gameChatLifecycleEventId, markGameChatGenerationQueuedTx, reserveGameChatLifecycleTx } from "../src/lib/game/chat-lifecycle-receipt";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "../src/lib/hosted-onboarding/linq-observability-identifiers";
import { recordHostedLinqRuntimeProviderDispatchFenceTx } from "../src/lib/hosted-onboarding/linq-delivery-store";

const publication = vi.hoisted(() => ({ signal: vi.fn(), route: vi.fn(), runtime: vi.fn(), access: vi.fn(), exact: vi.fn(), audience: vi.fn(), rooms: new Map<string, string[]>(), phones: new Map<string, string>() }));
vi.mock("../src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedMailboxAppendRuntime: publication.signal }));
vi.mock("../src/lib/hosted-execution/runtime-owner", () => ({ requireHostedRuntimeCallbackTx: publication.runtime }));
vi.mock("../src/lib/hosted-mailbox/runtime-access", () => ({ requireHostedRuntimeActiveAccessForUpdateTx: publication.access }));
vi.mock("../src/lib/game/chat-membership", async original => {
  const actual = await original<typeof import("../src/lib/game/chat-membership")>();
  return { ...actual, requireExactChat: async () => {}, requireExactGameChat: publication.exact, readGameChatAudience: publication.audience,
    readGroupGameNoticeAuthority: async (...[game, room, prepared, prisma]: Parameters<typeof actual.readGroupGameNoticeAuthority>) =>
      actual.readGameChatAuthority(game, room, prepared ?? await publication.audience(room), prisma, true) };
});
vi.mock("../src/lib/hosted-routing/thread-route-store", async original => ({ ...await original<object>(),
  readHostedThreadRouteByThreadIdentity: async ({ threadId }: { threadId: string }) => ({ containerMemberId: threadId }) }));
vi.mock("../src/lib/hosted-onboarding/hosted-member-identity-store", async original => ({ ...await original<typeof import("../src/lib/hosted-onboarding/hosted-member-identity-store")>(),
  readHostedMemberIdentity: async ({ memberId }: { memberId: string }) => ({ phoneNumber: publication.phones.get(memberId), phoneNumberVerifiedAt: new Date() }) }));
vi.mock("../src/lib/hosted-routing/assistant-notification-destination", async original => ({ ...await original<typeof import("../src/lib/hosted-routing/assistant-notification-destination")>(),
  assertHostedAssistantNotificationRouteAuthority: publication.route,
  resolveHostedAssistantNotificationDestination: async ({ memberId }: { memberId: string }) => ({ conversationShape: "thread-container",
    route: { channel: "linq", delivery: { kind: "thread", target: "synthetic-chat" }, threadIsDirect: false, actorId: null, identityId: null, threadId: null },
    externalThreadRouteAuthority: { channel: "linq", containerMemberId: memberId, threadId: "synthetic-chat" } }),
}));
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_/u.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Recap witness proof requires an isolated loopback test database.");
}
const members: string[] = [], games: string[] = [], deliveryIds: string[] = [];
const quote = "The synthetic blue kite crossed the field.";
const recap = { pages: [
  { background: "paper" as const, blocks: [{ kind: "quote" as const, quote: { who: "Alex", text: quote } }] },
  { background: "sage" as const, blocks: [{ kind: "headline" as const, text: "A finished week" }] },
  { background: "slate" as const, blocks: [{ kind: "headline" as const, text: "Two walks" }] },
], chatLine: "The story is in the app." };

async function fixture(witness = true, queued = true, existingPlayers?: string[]) {
  const db = getPrisma(), gameId = randomUUID(), room = randomUUID();
  const players = existingPlayers ?? [randomUUID(), randomUUID()];
  const newPlayers = existingPlayers ? [] : players;
  publication.rooms.set(room, players);
  players.forEach((id, seat) => publication.phones.set(id, `+1555555010${seat + 1}`));
  members.push(...newPlayers, room); games.push(gameId);
  await db.hostedMember.createMany({ data: [...newPlayers, room].map(id => ({ id, billingStatus: "active" })) });
  for (const [seat, memberId] of newPlayers.entries()) {
    await db.gameProfile.create({ data: { memberId, timeZone: "UTC", firstNameEncrypted: (await sealGameText(
      { table: "game_profile", field: "first_name", rowId: memberId, memberId }, seat ? "Sam" : "Alex"))! } });
  }
  const termsWordsEncrypted = (await sealGameText({ table: "game", field: "terms_words", rowId: gameId, memberId: players[0]! }, JSON.stringify({
    v: 1, versions: [{ n: 1, tasks: [{ seat: 0, text: "Walk" }, { seat: 1, text: "Walk" }], stakes: [] }],
  })))!;
  await db.game.create({ data: {
    id: gameId, createdBy: players[0], wordsOwnerMemberId: players[0], status: "settled", lengthDays: 7, chatContainerMemberId: room,
    startedAt: new Date("2030-01-01T00:00:00Z"), settledAt: new Date("2030-01-08T12:00:00Z"), termsWordsEncrypted,
    terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { count: 7 }, stakes: [] }] },
    result: { v: 1, termsVersion: 1, scores: players.map((memberId, seat) => ({ memberId, seat, score: 1, misses: 6 })) },
    players: { create: players.map((memberId, seat) => ({ memberId, seat, joinedAt: new Date("2030-01-01T00:00:00Z"), timeZone: "UTC", dayOne: new Date("2030-01-01T00:00:00Z") })) },
    tickets: { create: { id: randomUUID(), stakeKey: "synthetic-stake", owedBySeats: [0], owedToSeats: [1] } },
  } });
  const entries = [];
  for (const [seat, memberId] of players.entries()) {
    const id = randomUUID();
    entries.push(await db.gameEntry.create({ data: { id, gameId, memberId, dayIndex: 0, attempt: 1, kind: "words",
      receivedAt: new Date(Date.UTC(2030, 0, 1, 12, seat)), textEncrypted: await sealGameText({ table: "game_entry", field: "text", rowId: id, memberId }, seat ? "A synthetic quiet walk." : quote) } }));
  }
  const eventId = gameChatLifecycleEventId(gameId, "recap");
  await reserveGameChatLifecycleTx({ gameId, kind: "recap", now: new Date(), tx: db });
  if (queued) await markGameChatGenerationQueuedTx(eventId, db, room);
  if (witness) await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM game WHERE id = ${gameId} FOR UPDATE`;
    expect(await recordGameRecapWitnessTx(tx, gameId, eventId)).toBe(true);
  });
  const sealInput = { beforeMutationTx: async () => {}, containerMemberId: room, eventId, gameId, playerMemberIds: players, recap };
  return { db, gameId, players, room, entries, eventId, sealInput };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function report(f: Fixture, entryId = f.entries[0]!.id) {
  const row = await f.db.gameEntry.findUniqueOrThrow({ where: { id: entryId } });
  return f.db.gameReport.create({ data: { id: randomUUID(), gameId: f.gameId, entryId, about: "post", reason: "harassment",
    reporterMemberId: f.players.find(id => id !== row.memberId)!, reportedMemberId: row.memberId } });
}
async function remove(f: Fixture, entryId = f.entries[0]!.id) {
  const r = await report(f, entryId);
  expect(await reviewGameReport({ reportId: r.id, removePost: true })).toEqual({ found: true });
}
const story = (f: Fixture) => f.db.game.findUniqueOrThrow({ where: { id: f.gameId } });
const receipt = (f: Fixture) => f.db.hostedLinqDelivery.findUniqueOrThrow({ where: { idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(f.eventId)! } });
const material = (f: Fixture) => readGameRecapMaterial(f.gameId, f.room, f.players, f.eventId);
const dispatch = async (f: Fixture) => {
  const audience = await publication.audience(f.room);
  return f.db.$transaction(tx => assertGameProposalDeliveryCurrentTx({ tx, containerMemberId: f.room, audience, deliveryIdempotencyKey: f.eventId }));
};
// Old Web removed the entry without clearing the stored story or recording a report.
const oldRemoval = (f: Fixture, entryId = f.entries[0]!.id) => f.db.gameEntry.update({ where: { id: entryId }, data: {
  blurHash: null, mediaKeys: [], payloadEncrypted: null, textEncrypted: null, withdrawnAt: new Date(), withdrawnReason: "removed",
} });
const cleanRecap = { ...recap, pages: recap.pages.slice(1).concat(recap.pages.slice(1, 2)) };
async function retired(f: Fixture, before: Awaited<ReturnType<typeof receipt>>) {
  const after = await receipt(f);
  expect(after.skippedAt).toBeInstanceOf(Date);
  expect(after).toEqual({ ...before, status: "skipped", skipReason: "game_recap_retired", skippedAt: after.skippedAt,
    retryAfterAt: null, updatedAt: after.updatedAt });
}
async function measureRead<T>(read: () => Promise<T>) {
  const operations: PrismaOperationTiming[] = [];
  const value = await runWithPrismaOperationTimings(operations, read);
  return { value, operations: operations.map(operation => operation.key).sort(),
    gameReads: operations.filter(operation => operation.key.startsWith("Game.")).map(operation => operation.key).sort(),
    eventReads: operations.filter(operation => operation.key.startsWith("GameEvent.")).map(operation => operation.key).sort() };
}
async function regenerate(f: Fixture, beforePublication?: () => Promise<unknown>) {
  expect(await sealGameRecap(f.sealInput)).toEqual(recap);
  const prior = await f.db.hostedLinqDelivery.update({ where: { id: (await receipt(f)).id }, data: { status: "delivered" } });
  deliveryIds.push(prior.id);
  const regenerationId = "synthetic_regeneration";
  expect((await requestGameRecapRegeneration({ gameId: f.gameId, regenerationId, execute: true, operatorMemberId: "system" })).outcome).toBe("reserved");
  const eventId = gameChatLifecycleEventId(f.gameId, "recap", undefined, regenerationId);
  await markGameChatGenerationQueuedTx(eventId, f.db, f.room);
  await beforePublication?.();
  await f.db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM game WHERE id = ${f.gameId} FOR UPDATE`;
    expect(await recordGameRecapWitnessTx(tx, f.gameId, eventId)).toBe(true);
  });
  return { ...f, eventId, sealInput: { ...f.sealInput, eventId } };
}

describe.skipIf(!enabled)("recap moderation witness PostgreSQL proof", () => {
  beforeEach(() => {
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "https://recaps.murph.test");
    publication.exact.mockImplementation(async (room: string) => publication.rooms.get(room) ?? []);
    publication.audience.mockImplementation(async (room: string) => ({ memberIds: publication.rooms.get(room) ?? [],
      contacts: [], resolvedContacts: [], keys: { current: null, candidates: [] }, threadId: room }));
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    publication.signal.mockReset(); publication.route.mockReset(); publication.phones.clear(); publication.rooms.clear();
    publication.runtime.mockReset(); publication.access.mockReset(); publication.exact.mockReset(); publication.audience.mockReset();
    await getPrisma().hostedLinqDelivery.deleteMany({ where: { OR: [{ id: { in: deliveryIds.splice(0) } }, ...games.flatMap(gameId => [{ sourceRef: gameId }, { sourceRef: { startsWith: `${gameId}:` } }])] } });
    await getPrisma().game.deleteMany({ where: { id: { in: games.splice(0) } } });
    await getPrisma().hostedMember.deleteMany({ where: { id: { in: members.splice(0) } } });
  });

  describe("retirement activation", () => {
    const unavailable = (action: "read_game" | "write_recap") => ({ action, result: { status: "unavailable", error: "recap_authority_unavailable" } });
    const terminal = (action: "read_game" | "write_recap") => ({ action, result: { status: "unavailable", error: GAME_RECAP_GENERATION_RETIRED } });
    const tool = (f: Fixture, action: "read_game" | "write_recap", submitted: HostedGameRecap = recap, multiplayer = false) => {
      const origin = { kind: "game_recap" as const, gameId: f.gameId, eventId: f.eventId };
      return handleGameChatTool({ memberId: f.room, runtimeIdentity: null, multiplayer,
        request: action === "read_game" ? { action, origin } : { action, origin, recap: submitted, priorChatLines: [] } });
    };
    const savedResponse = (f: Fixture, saved: HostedGameRecap) => ({ action: "write_recap", result: { status: "ok",
      recapOutcome: "ok: saved. The players will see this recap.", recap: saved, chatLine: gameRecapMessage(f.gameId, saved.chatLine) } });
    async function published() {
      const f = await fixture(false, false);
      expect(await deliverGameChatLifecycle(f.gameId, "recap")).toBe(true);
      expect((await receipt(f)).status).toBe("generation_queued");
      expect((await f.db.gameEvent.findUniqueOrThrow({ where: { commandKey: `${f.eventId}:witness` } })).payload)
        .toEqual({ v: 1, entryIds: expect.arrayContaining(f.entries.map(entry => entry.id)) });
      expect(await f.db.hostedMailboxItem.count({ where: { userId: f.room } })).toBe(1);
      return f;
    }
    async function unchangedSettlement(f: Fixture) {
      return { result: (await story(f)).result, tickets: await f.db.gameTicket.findMany({ where: { gameId: f.gameId }, orderBy: { id: "asc" } }) };
    }
    async function rows(f: Fixture) {
      return { game: await story(f), receipt: await receipt(f),
        events: await f.db.gameEvent.findMany({ where: { gameId: f.gameId }, orderBy: { id: "asc" } }),
        entries: await f.db.gameEntry.findMany({ where: { gameId: f.gameId }, orderBy: { id: "asc" } }),
        mailbox: await f.db.hostedMailboxItem.findMany({ where: { userId: f.room }, orderBy: { id: "asc" } }),
        ...await unchangedSettlement(f) };
    }

    it.each(["before material", "after material", "after generation"])("retires published work %s and publishes a clean successor", async timing => {
      const f = await published(), settlement = await unchangedSettlement(f), queued = await receipt(f);
      if (timing !== "before material") expect(await tool(f, "read_game")).toEqual({ action: "read_game", result: { status: "ok", recapGame: (await material(f))!.game } });
      if (timing === "after generation") expect(await tool(f, "write_recap")).toEqual(savedResponse(f, recap));
      await remove(f);
      // Immediate retirement must not depend on any later callback.
      await retired(f, queued);
      publication.exact.mockRejectedValue(new Error("Synthetic roster unavailable"));
      for (const action of ["read_game", "write_recap"] as const) expect(await tool(f, action)).toEqual(terminal(action));
      publication.exact.mockImplementation(async () => f.players);
      expect((await story(f)).recapEncrypted).toBeNull();
      await expect(dispatch(f)).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
      await retired(f, queued);
      const regenerationId = "activation_successor";
      const eventId = gameChatLifecycleEventId(f.gameId, "recap", undefined, regenerationId);
      expect(await requestGameRecapRegeneration({ gameId: f.gameId, regenerationId, execute: true, operatorMemberId: "system" }))
        .toEqual({ gameId: f.gameId, regenerationId, eventId, dryRun: false, outcome: "reserved" });
      expect(await deliverGameChatLifecycle(f.gameId, "recap", undefined, new Date(), regenerationId)).toBe(true);
      const next = { ...f, eventId, sealInput: { ...f.sealInput, eventId } };
      expect((await f.db.gameEvent.findUniqueOrThrow({ where: { commandKey: `${eventId}:witness` } })).payload)
        .toEqual({ v: 1, entryIds: [f.entries[1]!.id] });
      const nextMaterial = await material(next);
      expect(nextMaterial?.entries).toEqual([{ entryId: f.entries[1]!.id, kind: "words", playerName: "Sam", text: "A synthetic quiet walk.", visibleToBoth: true }]);
      expect(await tool(next, "read_game")).toEqual({ action: "read_game", result: { status: "ok", recapGame: nextMaterial!.game } });
      expect(await tool(next, "write_recap", cleanRecap)).toEqual(savedResponse(next, cleanRecap));
      expect(await dispatch(next)).toBe(true);
      expect((await readGame(f.gameId, f.players[0]!))?.recap).toEqual(cleanRecap);
      expect((await readGame(f.gameId, f.players[1]!))?.recap).toBeNull(); // Existing reporter suppression.
      expect(await unchangedSettlement(f)).toEqual(settlement);
    });

    it.each(["pair report", "legacy removal"])("lazily retires %s in the same material call", async cause => {
      const f = cause === "pair report" ? await published() : await fixture(false);
      if (cause === "pair report") await report(f); else await oldRemoval(f);
      const queued = await receipt(f), settlement = await unchangedSettlement(f);
      // The throwing egress fence must remain a pure read.
      await expect(dispatch(f)).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
      expect(await receipt(f)).toEqual(queued);
      expect(await tool(f, "read_game")).toEqual(terminal("read_game"));
      await retired(f, queued);
      expect(await tool(f, "write_recap")).toEqual(terminal("write_recap"));
      expect((await story(f)).recapEncrypted).toBeNull();
      expect(await unchangedSettlement(f)).toEqual(settlement);
    });

    it("ends published pair work after a real block, including after unblock", async () => {
      const f = await published(), queued = await receipt(f), settlement = await unchangedSettlement(f);
      expect(await runGameCommand({ actorMemberId: f.players[0]!, command: { type: "block", memberId: f.players[1]! } })).toMatchObject({ ok: true });
      const blocked = await receipt(f), before = await rows(f);
      expect(blocked.skippedAt).toBeInstanceOf(Date);
      expect(blocked).toEqual({ ...queued, status: "skipped", skipReason: "game_blocked", skippedAt: blocked.skippedAt,
        retryAfterAt: null, updatedAt: blocked.updatedAt });
      expect((await story(f)).chatContainerMemberId).toBeNull();
      expect(await unchangedSettlement(f)).toEqual(settlement);
      for (const action of ["read_game", "write_recap"] as const) expect(await tool(f, action)).toEqual(terminal(action));
      const regeneration = { gameId: f.gameId, regenerationId: "blocked_successor", execute: true, operatorMemberId: "system" };
      expect((await requestGameRecapRegeneration(regeneration)).outcome).toBe("chat_unavailable");
      expect(await rows(f)).toEqual(before);
      expect(await runGameCommand({ actorMemberId: f.players[0]!, command: { type: "unblock", memberId: f.players[1]! } })).toMatchObject({ ok: true });
      for (const action of ["read_game", "write_recap"] as const) expect(await tool(f, action)).toEqual(terminal(action));
      expect((await requestGameRecapRegeneration(regeneration)).outcome).toBe("chat_unavailable");
      expect(await rows(f)).toEqual(before);
    });

    it("returns terminal when a real pair block wins between material and the final seal", async () => {
      const f = await published();
      publication.runtime.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockImplementationOnce(async () => {
        expect(await runGameCommand({ actorMemberId: f.players[0]!, command: { type: "block", memberId: f.players[1]! } })).toMatchObject({ ok: true });
      });
      expect(await tool(f, "write_recap")).toEqual(terminal("write_recap"));
      expect(await receipt(f)).toMatchObject({ status: "skipped", skipReason: "game_blocked" });
      expect((await story(f)).recapEncrypted).toBeNull();
    });

    it("keeps a temporary block row uncertain and resumes the unskipped generation", async () => {
      const f = await published(), queued = JSON.stringify(await receipt(f));
      const block = { blockerMemberId: f.players[0]!, blockedMemberId: f.players[1]! };
      await f.db.gameBlock.create({ data: block });
      for (const action of ["read_game", "write_recap"] as const) {
        expect(await tool(f, action)).toEqual(unavailable(action));
        expect(JSON.stringify(await receipt(f))).toBe(queued);
      }
      await f.db.gameBlock.delete({ where: { blockerMemberId_blockedMemberId: block } });
      expect(await tool(f, "read_game")).toEqual({ action: "read_game", result: { status: "ok", recapGame: (await material(f))!.game } });
      expect(await tool(f, "write_recap")).toEqual(savedResponse(f, recap));
      expect((await story(f)).recapEncrypted).not.toBeNull();
      expect(JSON.stringify(await receipt(f))).toBe(queued);
    });

    it("keeps published group work queued during a real block", async () => {
      const f = await published();
      await f.db.game.update({ where: { id: f.gameId }, data: { maxPlayers: 10 } });
      publication.audience.mockResolvedValue({ memberIds: f.players });
      const queued = await receipt(f);
      expect(await runGameCommand({ actorMemberId: f.players[0]!, multiplayer: true, command: { type: "block", memberId: f.players[1]! } })).toMatchObject({ ok: true });
      expect(await receipt(f)).toEqual(queued);
      expect((await receipt(f)).status).toBe("generation_queued");
      const before = await rows(f);
      for (const action of ["read_game", "write_recap"] as const) expect(await tool(f, action, recap, true)).toEqual(unavailable(action));
      expect(await rows(f)).toEqual(before);
    });

    it("ends an older group generation already skipped for a block", async () => {
      const f = await published();
      await f.db.game.update({ where: { id: f.gameId }, data: { maxPlayers: 10, chatContainerMemberId: null } });
      await f.db.hostedLinqDelivery.update({ where: { id: (await receipt(f)).id },
        data: { status: "skipped", skipReason: "game_blocked", skippedAt: new Date(), retryAfterAt: null } });
      const before = await rows(f);
      for (const action of ["read_game", "write_recap"] as const) expect(await tool(f, action, recap, true)).toEqual(terminal(action));
      expect(await rows(f)).toEqual(before);
    });

    it("returns terminal when a report wins between material and the final seal", async () => {
      const f = await published(), queued = await receipt(f);
      publication.runtime.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockImplementationOnce(async () => { await report(f); });
      expect(await tool(f, "write_recap")).toEqual(terminal("write_recap"));
      await retired(f, queued);
      expect((await story(f)).recapEncrypted).toBeNull();
    });

    it("answers retirement at replay before validation or another roster read", async () => {
      const f = await published(), queued = await receipt(f);
      publication.runtime.mockResolvedValueOnce(undefined).mockImplementationOnce(async () => { await report(f); });
      expect(await tool(f, "write_recap", { ...recap, pages: [] })).toEqual(terminal("write_recap"));
      await retired(f, queued);
      expect(publication.exact).toHaveBeenCalledTimes(1);
      expect((await story(f)).recapEncrypted).toBeNull();
    });

    it("keeps unreadable storage uncertain without changing the receipt", async () => {
      const f = await published(), queued = JSON.stringify(await receipt(f));
      await f.db.game.update({ where: { id: f.gameId }, data: { termsWordsEncrypted: "synthetic-invalid-ciphertext" } });
      for (const action of ["read_game", "write_recap"] as const) {
        await expect(tool(f, action)).rejects.toThrow();
        expect(JSON.stringify(await receipt(f))).toBe(queued);
      }
    });

    it.each(["roster", "runtime", "access", "group audience", "healthy"])("preserves uncertainty and the whole receipt for %s", async cause => {
      const f = await published(), queued = JSON.stringify(await receipt(f));
      const failure = new Error(`Synthetic ${cause} unavailable`);
      if (cause !== "healthy") await report(f);
      if (cause === "group audience") {
        await f.db.game.update({ where: { id: f.gameId }, data: { maxPlayers: 10 } });
        publication.audience.mockResolvedValue({ memberIds: f.players });
      }
      for (const action of ["read_game", "write_recap"] as const) {
        if (cause === "roster") publication.exact.mockRejectedValue(failure);
        if (cause === "runtime") publication.runtime.mockRejectedValue(failure);
        if (cause === "access") publication.access.mockRejectedValue(failure);
        if (["roster", "runtime", "access"].includes(cause)) await expect(tool(f, action)).rejects.toBe(failure);
        else if (cause === "group audience") expect(await tool(f, action, recap, true)).toEqual(unavailable(action));
        else expect(await tool(f, action)).toEqual(action === "read_game"
          ? { action, result: { status: "ok", recapGame: (await material(f))!.game } } : savedResponse(f, recap));
        expect(JSON.stringify(await receipt(f))).toBe(queued);
      }
    });

    it("preserves the ambiguous provider claim through takedown and regeneration", async () => {
      const f = await published();
      expect(await tool(f, "write_recap")).toEqual(savedResponse(f, recap));
      expect((await f.db.$transaction(async tx => {
        await assertGameProposalDeliveryCurrentTx({ tx, containerMemberId: f.room, audience: await publication.audience(f.room), deliveryIdempotencyKey: f.eventId });
        return recordHostedLinqRuntimeProviderDispatchFenceTx({ idempotencyKey: f.eventId, linqChatId: "synthetic-chat", sourceRef: f.eventId, targetKind: "thread", prisma: tx });
      })).claimed).toBe(true);
      const claimed = JSON.stringify(await receipt(f)), settlement = await unchangedSettlement(f);
      deliveryIds.push((await receipt(f)).id);
      await remove(f);
      for (const action of ["read_game", "write_recap"] as const) expect(await tool(f, action)).toEqual(unavailable(action));
      expect((await requestGameRecapRegeneration({ gameId: f.gameId, regenerationId: "claimed_successor", execute: true, operatorMemberId: "system" })).outcome).toBe("delivery_pending");
      expect(JSON.stringify(await receipt(f))).toBe(claimed);
      expect(await unchangedSettlement(f)).toEqual(settlement);
    });

    it.each(["outside witness", "awaiting_generation", "clean legacy", "game_lifecycle_superseded"])("does not retire %s", async cause => {
      const f = await fixture(false, cause !== "awaiting_generation");
      if (cause === "outside witness") {
        await f.db.gameEntry.update({ where: { id: f.entries[0]!.id }, data: { withdrawnAt: new Date(), withdrawnReason: "replaced" } });
        await f.db.$transaction(tx => recordGameRecapWitnessTx(tx, f.gameId, f.eventId));
      }
      if (cause === "game_lifecycle_superseded") await f.db.hostedLinqDelivery.update({ where: { id: (await receipt(f)).id }, data: { status: "skipped", skipReason: "game_lifecycle_superseded", skippedAt: new Date() } });
      const before = JSON.stringify(await receipt(f));
      if (cause === "outside witness" || cause === "awaiting_generation") await remove(f);
      if (cause === "game_lifecycle_superseded") await report(f);
      if (cause === "outside witness" || cause === "clean legacy") {
        expect(await tool(f, "read_game")).toEqual({ action: "read_game", result: { status: "ok", recapGame: (await material(f))!.game } });
        expect(await tool(f, "write_recap", cleanRecap)).toEqual(savedResponse(f, cleanRecap));
      } else for (const action of ["read_game", "write_recap"] as const) expect(await tool(f, action)).toEqual(unavailable(action));
      expect(JSON.stringify(await receipt(f))).toBe(before);
      if (cause === "awaiting_generation") {
        expect(await deliverGameChatLifecycle(f.gameId, "recap")).toBe(true);
        expect((await f.db.gameEvent.findUniqueOrThrow({ where: { commandKey: `${f.eventId}:witness` } })).payload).toEqual({ v: 1, entryIds: [f.entries[1]!.id] });
        expect(await tool(f, "write_recap", cleanRecap)).toEqual(savedResponse(f, cleanRecap));
      }
    });

    it.each(["removed", "reported"])("dry run leaves stale %s work untouched and execute retires before reserving", async cause => {
      const f = await published();
      if (cause === "removed") await oldRemoval(f); else await report(f);
      const before = await rows(f), queued = await receipt(f);
      const request = { gameId: f.gameId, regenerationId: "dry_run_successor", operatorMemberId: "system" };
      const eventId = gameChatLifecycleEventId(f.gameId, "recap", undefined, request.regenerationId);
      expect(await requestGameRecapRegeneration({ ...request, execute: false })).toEqual({ gameId: f.gameId, regenerationId: request.regenerationId, eventId, dryRun: true, outcome: "would_regenerate" });
      expect(await rows(f)).toEqual(before);
      expect(await requestGameRecapRegeneration({ ...request, execute: true })).toEqual({ gameId: f.gameId, regenerationId: request.regenerationId, eventId, dryRun: false, outcome: "reserved" });
      await retired(f, queued);
    });

    it("permits regeneration after lazy report retirement without a stored story", async () => {
      const f = await published();
      await report(f);
      expect(await tool(f, "read_game")).toEqual(terminal("read_game"));
      expect((await requestGameRecapRegeneration({ gameId: f.gameId, regenerationId: "retired_successor", execute: true, operatorMemberId: "system" })).outcome).toBe("reserved");
    });

    it("keeps a healthy empty generation unavailable and invalid event identities nonterminal", async () => {
      const f = await published(), before = await rows(f);
      for (const execute of [false, true]) expect((await requestGameRecapRegeneration({ gameId: f.gameId, regenerationId: "healthy_successor", execute, operatorMemberId: "system" })).outcome).toBe("recap_unavailable");
      for (const action of ["read_game", "write_recap"] as const) expect(await tool({ ...f, eventId: "invalid" }, action)).toEqual(unavailable(action));
      expect(await rows(f)).toEqual(before);
    });
  });

  it("clears a sealed quote for the nonreporter without changing result, tickets or other entries", async () => {
    const f = await fixture();
    expect(await sealGameRecap(f.sealInput)).toEqual(recap);
    expect((await readGame(f.gameId, f.players[0]!))?.recap).toEqual(recap);
    const before = await story(f), queued = await receipt(f);
    const tickets = await f.db.gameTicket.findMany({ where: { gameId: f.gameId } });
    await remove(f);
    expect((await readGame(f.gameId, f.players[0]!))?.recap).toBeNull();
    const after = await story(f);
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
    expect(after).toEqual({ ...before, recapEncrypted: null, updatedAt: after.updatedAt });
    expect(await f.db.gameTicket.findMany({ where: { gameId: f.gameId } })).toEqual(tickets);
    expect(await f.db.gameEntry.findUniqueOrThrow({ where: { id: f.entries[1]!.id } })).toEqual(f.entries[1]);
    await retired(f, queued);
  });

  for (const regeneration of [false, true]) {
    it.each(["before material", "after material", "after seal"])(`refuses removal %s for ${regeneration ? "accepted regeneration" : "first generation"}`, async timing => {
      let f = await fixture();
      if (regeneration) { f = await regenerate(f); expect(await sealGameRecap(f.sealInput)).toEqual(recap); }
      if (timing !== "before material") expect((await material(f))?.entries).toEqual(f.entries.map((e, i) => ({ entryId: e.id, kind: "words", playerName: i ? "Sam" : "Alex", text: i ? "A synthetic quiet walk." : quote, visibleToBoth: true })));
      if (timing === "after seal") expect(await sealGameRecap(f.sealInput)).toEqual(recap);
      const queued = await receipt(f);
      await remove(f);
      if (timing === "before material") expect(await material(f)).toBeNull();
      expect(await sealGameRecap({ ...f.sealInput, recap: timing === "after seal" ? null : recap })).toBeNull();
      expect(await material(f)).toBeNull();
      expect(await sealGameRecap({ ...f.sealInput, recap: null })).toBeNull();
      await expect(dispatch(f)).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
      expect((await story(f)).recapEncrypted).toBeNull();
      await retired(f, queued);
      expect(queued.status).toBe("generation_queued");
    });
  }

  it("refuses a pair report racing seal and dispatch while retaining the stored story", async () => {
    const f = await fixture();
    await sealGameRecap(f.sealInput);
    const before = await story(f);
    await report(f);
    await expect(dispatch(f)).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
    expect(await material(f)).toBeNull();
    expect(await sealGameRecap(f.sealInput)).toBeNull();
    expect(await story(f)).toEqual(before);
  });

  it.each(["clean", "removed", "reported"])("keeps legacy generation %s unwitnessed through reads, seal, replay and dispatch", async condition => {
    const f = await fixture(false);
    expect(await material(f)).not.toBeNull();
    expect(await sealGameRecap(f.sealInput)).toEqual(recap);
    const before = await story(f);
    if (condition === "removed") await remove(f);
    if (condition === "reported") await report(f);
    if (condition === "clean") {
      expect(await material(f)).not.toBeNull();
      expect(await sealGameRecap(f.sealInput)).toEqual(recap);
      expect(await sealGameRecap({ ...f.sealInput, recap: null })).toEqual(recap);
      expect(await dispatch(f)).toBe(true);
    } else {
      expect(await material(f)).toBeNull();
      expect(await sealGameRecap(f.sealInput)).toBeNull();
      expect(await sealGameRecap({ ...f.sealInput, recap: null })).toBeNull();
      await expect(dispatch(f)).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
    }
    const after = await story(f);
    expect(after).toEqual({ ...before, recapEncrypted: condition === "removed" ? null : before.recapEncrypted, updatedAt: condition === "removed" ? after.updatedAt : before.updatedAt });
    expect(await f.db.gameEvent.findUnique({ where: { commandKey: `${f.eventId}:witness` } })).toBeNull();
  });

  it("clears the story after an ambiguous provider claim without changing the receipt", async () => {
    const f = await fixture();
    await sealGameRecap(f.sealInput);
    expect((await f.db.$transaction(async tx => {
      await assertGameProposalDeliveryCurrentTx({ tx, containerMemberId: f.room, audience: await publication.audience(f.room), deliveryIdempotencyKey: f.eventId });
      return recordHostedLinqRuntimeProviderDispatchFenceTx({ idempotencyKey: f.eventId, linqChatId: "synthetic-chat", sourceRef: f.eventId, targetKind: "thread", prisma: tx });
    })).claimed).toBe(true);
    const claimed = await receipt(f); deliveryIds.push(claimed.id);
    await remove(f);
    expect((await story(f)).recapEncrypted).toBeNull();
    expect(await receipt(f)).toEqual(claimed);
  });

  it.each(["removed", "replaced"])("a clean witness excludes an entry already %s and keeps its story on takedown", async condition => {
    const f = await fixture(false, false);
    if (condition === "removed") await remove(f);
    else await f.db.gameEntry.update({ where: { id: f.entries[0]!.id }, data: { withdrawnAt: new Date(), withdrawnReason: "replaced" } });
    await f.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM game WHERE id = ${f.gameId} FOR UPDATE`;
      expect(await recordGameRecapWitnessTx(tx, f.gameId, f.eventId)).toBe(true);
    });
    const witness = await f.db.gameEvent.findUniqueOrThrow({ where: { commandKey: `${f.eventId}:witness` } });
    expect(witness.payload).toEqual({ v: 1, entryIds: [f.entries[1]!.id] });
    await markGameChatGenerationQueuedTx(f.eventId, f.db, f.room);
    expect((await material(f))?.entries).toEqual([{ entryId: f.entries[1]!.id, kind: "words", playerName: "Sam", text: "A synthetic quiet walk.", visibleToBoth: true }]);
    const clean = { ...recap, pages: recap.pages.slice(1).concat(recap.pages.slice(1, 2)) };
    expect(await sealGameRecap({ ...f.sealInput, recap: clean })).toEqual(clean);
    const before = await story(f);
    if (condition === "replaced") await remove(f);
    expect(await story(f)).toEqual(before);
    expect(await material(f)).not.toBeNull();
    expect(await sealGameRecap({ ...f.sealInput, recap: null })).toEqual(clean);
    expect(await dispatch(f)).toBe(true);
  });

  it("takedown follows the accepted regeneration witness instead of the original story", async () => {
    const f = await fixture();
    // The replacement never sees this withdrawn entry, although the first story did.
    const next = await regenerate(f, () => f.db.gameEntry.update({ where: { id: f.entries[0]!.id }, data: { withdrawnAt: new Date(), withdrawnReason: "replaced" } }));
    const clean = { ...recap, pages: recap.pages.slice(1).concat(recap.pages.slice(1, 2)) };
    expect(await sealGameRecap({ ...next.sealInput, recap: clean })).toEqual(clean);
    const before = await story(f);
    await remove(f);
    expect(await story(f)).toEqual(before);
    expect(await material(next)).not.toBeNull();
    expect(await sealGameRecap({ ...next.sealInput, recap: null })).toEqual(clean);
    expect(await dispatch(next)).toBe(true);
    await expect(dispatch(f)).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
  });

  it("permits an empty witness and ignores pair reports without an entry", async () => {
    const f = await fixture(false, false);
    for (const entry of f.entries) await remove(f, entry.id);
    await f.db.gameReport.create({ data: { id: randomUUID(), gameId: f.gameId, about: "terms", reason: "other", reporterMemberId: f.players[1]!, reportedMemberId: f.players[0] } });
    await f.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM game WHERE id = ${f.gameId} FOR UPDATE`;
      expect(await recordGameRecapWitnessTx(tx, f.gameId, f.eventId)).toBe(true);
    });
    await markGameChatGenerationQueuedTx(f.eventId, f.db, f.room);
    expect((await material(f))?.entries).toEqual([]);
    const clean = { ...recap, pages: recap.pages.slice(1).concat(recap.pages.slice(1, 2)) };
    expect(await sealGameRecap({ ...f.sealInput, recap: clean })).toEqual(clean);
    expect(await dispatch(f)).toBe(true);
  });

  it("records the first publication witness only, even when later permitted entries change", async () => {
    const f = await fixture();
    const before = await f.db.gameEvent.findUniqueOrThrow({ where: { commandKey: `${f.eventId}:witness` } });
    await remove(f);
    await f.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM game WHERE id = ${f.gameId} FOR UPDATE`;
      expect(await recordGameRecapWitnessTx(tx, f.gameId, f.eventId)).toBe(true);
    });
    expect(await f.db.gameEvent.findUniqueOrThrow({ where: { commandKey: `${f.eventId}:witness` } })).toEqual(before);
    expect(await material(f)).toBeNull();
  });

  it.each([{ v: 2, entryIds: [] }, { v: 1, entryIds: [123] }, { v: 1 }, "malformed"])("fails closed on a malformed witness %j", async payload => {
    const f = await fixture();
    await sealGameRecap(f.sealInput);
    await f.db.gameEvent.update({ where: { commandKey: `${f.eventId}:witness` }, data: { payload } });
    expect(await material(f)).toBeNull();
    expect(await sealGameRecap(f.sealInput)).toBeNull();
    await expect(dispatch(f)).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
    await remove(f);
    expect((await story(f)).recapEncrypted).toBeNull();
  });

  it.each([false, true])("publishes mailbox, queued receipt and witness together; legacy mailbox=%s", async legacy => {
    const f = await fixture(false, false);
    if (legacy) {
      const prepared = await prepareHostedMailboxEnvelopeAppend({ prisma: f.db, envelope: buildHostedExecutionAssistantNotificationRequestedWake({
        eventId: f.eventId, memberId: f.room, occurredAt: new Date().toISOString(), notification: {
          instructions: "Synthetic legacy recap.", route: { channel: "linq", delivery: { kind: "thread", target: "synthetic-chat" }, threadIsDirect: false, actorId: null, identityId: null, threadId: null },
          responsePolicy: { kind: "require_game_recap", gameId: f.gameId, eventId: f.eventId, pairFingerprint: "synthetic-pair" },
        },
      }) });
      await f.db.$transaction(tx => appendPreparedHostedMailboxEnvelopeTx({ prepared, tx }));
    }
    publication.signal.mockImplementation(async () => {
      // The real append has committed before signalling the runtime.
      expect(await f.db.hostedMailboxItem.count({ where: { userId: f.room } })).toBe(1);
      expect((await receipt(f)).status).toBe("generation_queued");
      expect(await f.db.gameEvent.count({ where: { gameId: f.gameId, type: "recap_witness" } })).toBe(legacy ? 0 : 1);
    });
    expect(await deliverGameChatLifecycle(f.gameId, "recap")).toBe(true);
    const rows = async () => ({ mailbox: await f.db.hostedMailboxItem.findMany({ where: { userId: f.room } }), receipt: await receipt(f),
      witnesses: await f.db.gameEvent.findMany({ where: { gameId: f.gameId, type: "recap_witness" } }) });
    const before = await rows();
    if (!legacy) expect(new Set((await material(f))?.entries.map(e => e.entryId))).toEqual(new Set(f.entries.map(e => e.id)));
    expect(await deliverGameChatLifecycle(f.gameId, "recap")).toBe(true);
    expect(await rows()).toEqual(before);
    expect(publication.signal).toHaveBeenCalledTimes(2);
  });

  describe("stored story read suppression", () => {
    it("a: hides an old removal from both players without changing ciphertext and refuses chat delivery", async () => {
      const f = await fixture(false);
      expect(await sealGameRecap(f.sealInput)).toEqual(recap);
      await oldRemoval(f);
      const before = await story(f);
      expect(before.recapEncrypted).not.toBeNull();
      for (const player of f.players) expect.soft((await readGame(f.gameId, player))?.recap).toBeNull();
      expect(await story(f)).toEqual(before);
      await expect(dispatch(f)).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
    });

    it("b: keeps a reported-only legacy story visible only to the nonreporter", async () => {
      const f = await fixture(false);
      await sealGameRecap(f.sealInput);
      await report(f);
      const before = await story(f);
      expect((await readGame(f.gameId, f.players[0]!))?.recap).toEqual(recap);
      expect((await readGame(f.gameId, f.players[1]!))?.recap).toBeNull();
      expect(await story(f)).toEqual(before);
    });

    it("c: keeps a merely legacy story visible to both players", async () => {
      const f = await fixture(false);
      await sealGameRecap(f.sealInput);
      for (const player of f.players) expect((await readGame(f.gameId, player))?.recap).toEqual(recap);
    });

    it.each(["withdrawn", "retake"])("d: keeps a story visible when an entry is %s", async withdrawnReason => {
      const f = await fixture(false);
      await sealGameRecap(f.sealInput);
      await f.db.gameEntry.update({ where: { id: f.entries[0]!.id }, data: { withdrawnAt: new Date(), withdrawnReason } });
      for (const player of f.players) expect((await readGame(f.gameId, player))?.recap).toEqual(recap);
    });

    it("e: keeps a witnessed story visible when it excludes the removed entry", async () => {
      const f = await fixture(false);
      await oldRemoval(f);
      await f.db.$transaction(tx => recordGameRecapWitnessTx(tx, f.gameId, f.eventId));
      expect(await sealGameRecap({ ...f.sealInput, recap: cleanRecap })).toEqual(cleanRecap);
      const before = await story(f);
      for (const player of f.players) expect((await readGame(f.gameId, player))?.recap).toEqual(cleanRecap);
      expect(await story(f)).toEqual(before);
    });

    it("f: hides a witnessed story containing a removed entry from both players", async () => {
      const f = await fixture();
      await sealGameRecap(f.sealInput);
      await oldRemoval(f);
      const before = await story(f);
      for (const player of f.players) expect.soft((await readGame(f.gameId, player))?.recap).toBeNull();
      expect(await story(f)).toEqual(before);
    });

    it.each([{ v: 2, entryIds: [] }, { v: 1, entryIds: [123] }, { v: 1 }, "malformed"])("f: hides an old removal with malformed witness %j", async payload => {
      const f = await fixture();
      await sealGameRecap(f.sealInput);
      await f.db.gameEvent.update({ where: { commandKey: `${f.eventId}:witness` }, data: { payload } });
      await oldRemoval(f);
      const before = await story(f);
      for (const player of f.players) expect.soft((await readGame(f.gameId, player))?.recap).toBeNull();
      expect(await story(f)).toEqual(before);
    });

    it("g: shows the latest accepted clean regeneration of a hidden legacy story", async () => {
      const f = await fixture(false);
      await sealGameRecap(f.sealInput);
      let priorEventId = f.eventId;
      for (const [index, entry] of f.entries.entries()) {
        await oldRemoval(f, entry.id);
        const before = await story(f);
        for (const player of f.players) expect.soft((await readGame(f.gameId, player))?.recap).toBeNull();
        expect(await story(f)).toEqual(before);
        await f.db.hostedLinqDelivery.update({ where: { idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(priorEventId)! }, data: { status: "delivered" } });
        const regenerationId = `synthetic_clean_read_${index}`;
        expect((await requestGameRecapRegeneration({ gameId: f.gameId, regenerationId, execute: true, operatorMemberId: "system" })).outcome).toBe("reserved");
        const eventId = gameChatLifecycleEventId(f.gameId, "recap", undefined, regenerationId);
        await markGameChatGenerationQueuedTx(eventId, f.db, f.room);
        await f.db.$transaction(tx => recordGameRecapWitnessTx(tx, f.gameId, eventId));
        // A requested generation does not own the stored story until acceptance.
        for (const player of f.players) expect.soft((await readGame(f.gameId, player))?.recap).toBeNull();
        const replacement = { ...cleanRecap, chatLine: `A new story, edition ${index + 1}.` };
        expect(await sealGameRecap({ ...f.sealInput, eventId, recap: replacement })).toEqual(replacement);
        expect(await f.db.gameEvent.findUnique({ where: { commandKey: `${eventId}:accepted` } })).toMatchObject({ type: "recap_regeneration_accepted" });
        for (const player of f.players) expect((await readGame(f.gameId, player))?.recap).toEqual(replacement);
        priorEventId = eventId;
      }
    });

    it("g: hides older words when a clean regeneration commits during witness lookup", async () => {
      const f = await fixture(false);
      const next = await regenerate(f, () => oldRemoval(f));
      const before = await story(f);
      expect(before.recapEncrypted).not.toBeNull();
      expect(await f.db.gameEvent.findUnique({ where: { commandKey: `${f.eventId}:witness` } })).toBeNull();
      const findMany = f.db.gameEvent.findMany.bind(f.db.gameEvent);
      const lookup = vi.spyOn(f.db.gameEvent, "findMany").mockImplementation(args => {
        if (args?.where?.type !== "recap_regeneration_accepted") return findMany(args);
        lookup.mockRestore();
        const pending = (async () => {
          expect(await sealGameRecap({ ...next.sealInput, recap: cleanRecap })).toEqual(cleanRecap);
          expect((await story(f)).recapEncrypted).not.toBe(before.recapEncrypted);
          expect(await f.db.gameEvent.findUnique({ where: { commandKey: `${next.eventId}:accepted` } }))
            .toMatchObject({ type: "recap_regeneration_accepted" });
          return findMany(args);
        })();
        return {
          then: pending.then.bind(pending), catch: pending.catch.bind(pending), finally: pending.finally.bind(pending),
          [Symbol.toStringTag]: "PrismaPromise",
        };
      });
      try {
        const view = await readGame(f.gameId, f.players[0]!);
        expect.soft(view?.recap).toBeNull();
        expect.soft(JSON.stringify(view)).not.toContain(quote);
      } finally {
        lookup.mockRestore();
      }
      expect((await readGame(f.gameId, f.players[0]!))?.recap).toEqual(cleanRecap);
    });

    it("h: adds no event or game read for a story with no removed post", async () => {
      const f = await fixture(false);
      const empty = await measureRead(() => readGame(f.gameId, f.players[0]!));
      await sealGameRecap(f.sealInput);
      const stored = await measureRead(() => readGame(f.gameId, f.players[0]!));
      expect(stored.value?.recap).toEqual(recap);
      expect(stored.eventReads).toEqual(empty.eventReads);
      expect(stored.eventReads).toEqual(["GameEvent.findMany"]);
      expect(stored.gameReads).toEqual(empty.gameReads);
    });

    it("h: adds two batched event reads and one game read for one or several candidate games", async () => {
      const legacy = await fixture(false), included = await fixture(true, true, legacy.players), excluded = await fixture(false, true, legacy.players);
      await excluded.db.gameEntry.update({ where: { id: excluded.entries[0]!.id }, data: { withdrawnAt: new Date(), withdrawnReason: "retake" } });
      await excluded.db.$transaction(tx => recordGameRecapWitnessTx(tx, excluded.gameId, excluded.eventId));
      for (const f of [legacy, included, excluded]) await sealGameRecap({ ...f.sealInput, recap: cleanRecap });
      const baseline = await measureRead(() => readHome(legacy.players[0]!));
      expect(baseline.value.games).toHaveLength(3);
      expect(baseline.eventReads).toEqual(["GameEvent.findMany"]);
      await oldRemoval(legacy);
      const single = await measureRead(() => readHome(legacy.players[0]!));
      expect.soft(single.eventReads).toEqual([...baseline.eventReads, "GameEvent.findMany", "GameEvent.findMany"].sort());
      expect.soft(single.gameReads).toEqual([...baseline.gameReads, "Game.findMany"].sort());
      for (const f of [included, excluded]) await oldRemoval(f);
      const several = await measureRead(() => readHome(legacy.players[0]!));
      expect.soft(several.eventReads).toEqual([...baseline.eventReads, "GameEvent.findMany", "GameEvent.findMany"].sort());
      expect.soft(several.gameReads).toEqual([...baseline.gameReads, "Game.findMany"].sort());
      expect(several.value.games).toHaveLength(3);
      expect.soft(several.value.games.find(game => game.id === legacy.gameId)?.recap).toBeNull();
      expect.soft(several.value.games.find(game => game.id === included.gameId)?.recap).toBeNull();
      expect(several.value.games.find(game => game.id === excluded.gameId)?.recap).toEqual(cleanRecap);
    });

    it("i: adds nothing to the bounded history read path", async () => {
      const f = await fixture(false), other = await fixture(true, true, f.players);
      for (const game of [f, other]) await sealGameRecap(game.sealInput);
      const baseline = await measureRead(() => readHistory(f.players[0]!));
      expect(baseline.value.people[0]?.games).toHaveLength(2);
      for (const game of [f, other]) await oldRemoval(game);
      const removed = await measureRead(() => readHistory(f.players[0]!));
      expect(removed.value.people[0]?.games).toHaveLength(2);
      expect(removed.eventReads).toEqual(baseline.eventReads);
      expect(removed.eventReads).toEqual([]);
      expect(removed.operations).toEqual(baseline.operations);
    });
  });

  it.each(["delivered", "generation_queued", "never sealed"])("regeneration after takedown respects %s delivery", async state => {
    const f = await fixture();
    if (state !== "never sealed") {
      await sealGameRecap(f.sealInput);
      await f.db.hostedLinqDelivery.update({ where: { id: (await receipt(f)).id }, data: { status: state } });
      await remove(f);
      expect((await story(f)).recapEncrypted).toBeNull();
    }
    expect((await requestGameRecapRegeneration({ gameId: f.gameId, regenerationId: "synthetic_recovery", execute: true, operatorMemberId: "system" })).outcome)
      .toBe(state === "never sealed" ? "recap_unavailable" : "reserved");
  });
});
