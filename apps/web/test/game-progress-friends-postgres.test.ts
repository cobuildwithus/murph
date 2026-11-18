import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../src/lib/prisma";
import { hostedAuthAdapter } from "../src/lib/better-auth/adapter";
import { readHostedAuthSession } from "../src/lib/better-auth/session";
import { sealGameText } from "../src/lib/game/crypto";
import { lockGamePair } from "../src/lib/game/blocks";
import { friendsSchema } from "../src/lib/game/progress/contract";
import { openProgress, progressLookup } from "../src/lib/game/progress/crypto";
import { readAwards, settleAwards } from "../src/lib/game/progress/awards";
import { removeRetiredProgressAwards } from "../scripts/migrations/remove-retired-progress-awards";
import * as inference from "../src/lib/game/progress/infer";

const mocks = vi.hoisted(() => ({ after: vi.fn(), auth: vi.fn() }));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/src/lib/game/http/auth", async original => ({
  ...await original<typeof import("../src/lib/game/http/auth")>(), requireGameMemberAuth: mocks.auth,
}));
import { GET } from "../app/api/game/v1/progress/friends/route";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_[a-z0-9_]+$/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Friends proof needs an isolated loopback test database.");
const db = getPrisma();
const members: string[] = [], games: string[] = [];
const dayOne = new Date("2026-11-01T00:00:00Z");
const readFriends = () => GET(new Request("https://example.test/api/game/v1/progress/friends?measure=pushups.reps"));

async function member(name: string) {
  const id = randomUUID(); members.push(id);
  await db.hostedMember.create({ data: { id, billingStatus: "active" } });
  await db.gameProfile.create({ data: { memberId: id, timeZone: "UTC", createdAt: dayOne,
    firstNameEncrypted: (await sealGameText({ memberId: id, table: "game_profile", rowId: id, field: "first_name" }, name))! } });
  return id;
}

async function game(memberIds: string[], task: string) {
  const id = randomUUID(); games.push(id);
  const owner = memberIds[0];
  await db.game.create({ data: { id, createdBy: owner, wordsOwnerMemberId: owner, status: "live",
    terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { count: 7 }, stakes: [], checkInKind: "photo" }] },
    termsWordsEncrypted: (await sealGameText({ memberId: owner, table: "game", rowId: id, field: "terms_words" },
      JSON.stringify({ v: 1, versions: [{ n: 1, tasks: [], defaultTask: task, stakes: [] }] })))!,
    players: { create: memberIds.map((memberId, seat) => ({ memberId, seat, timeZone: "UTC", dayOne, joinedAt: dayOne })) },
  } });
  return id;
}

async function entry(gameId: string, memberId: string, dayIndex: number, count: number | null) {
  const id = randomUUID();
  await db.gameEntry.create({ data: { id, gameId, memberId, dayIndex, attempt: 1, kind: count === null ? "photo" : "reps",
    receivedAt: new Date(`2026-11-0${dayIndex + 1}T12:00:00Z`),
    payloadEncrypted: count === null ? null : await sealGameText({ memberId, table: "game_entry", rowId: id, field: "payload" },
      JSON.stringify({ exercise: "pushups", count, reps: [] })),
  } });
}

async function fixture(task: string) {
  const ava = await member("Ava"), leo = await member("Leo"), sam = await member("Sam");
  const shared = await game([ava, leo], "40 pushups");
  const other = await game([leo, sam], task);
  await entry(shared, ava, 0, 20); await entry(shared, ava, 1, 100); await entry(shared, leo, 0, 40);
  // Two dates for one phrase must schedule one classification owned by Leo.
  await entry(other, leo, 0, null); await entry(other, leo, 1, null);
  const adapter = hostedAuthAdapter(db)({});
  const dates = { createdAt: new Date(), updatedAt: new Date() }, token = randomUUID();
  await adapter.create({ model: "user", forceAllowId: true, data: {
    id: ava, email: `${ava}@example.test`, emailVerified: true, name: "", ...dates,
  } });
  await adapter.create({ model: "session", forceAllowId: true, data: {
    id: randomUUID(), userId: ava, token, expiresAt: new Date(Date.now() + 60_000), ...dates,
  } });
  const { session } = await readHostedAuthSession({ baseURL: "https://example.test", secret: "synthetic-session-proof-secret-for-tests",
    prisma: db, credential: token, transport: "native" });
  expect(session).not.toBeNull();
  mocks.auth.mockResolvedValue({ kind: "better-auth", ...session!, credential: token });
  return { ava, leo, shared, sessionId: session!.sessionId };
}

function provider(proposed: inference.InferredMeasure) {
  const fetch = vi.fn(async (url: RequestInfo | URL) => Response.json(String(url).endsWith("/decisions") ? {
    answers: ["amount", "stated", "activity"].map(name => ({ name, type: "predicate", probability: 1 })),
  } : { status: "completed", output: [], output_text: JSON.stringify(proposed) }));
  vi.spyOn(inference, "inferenceClient").mockReturnValue(new OpenAI({ apiKey: "synthetic", maxRetries: 0, fetch }));
  return fetch;
}

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-16T12:00:00Z"));
  vi.stubEnv("OPENAI_API_KEY", "synthetic");
  vi.stubEnv("HOSTED_AUTH_STORAGE_KEY", Buffer.alloc(32, 17).toString("base64url"));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(async () => {
  if (!enabled) return;
  await db.game.deleteMany({ where: { id: { in: games } } });
  await db.hostedMember.deleteMany({ where: { id: { in: members } } });
});

describe.skipIf(!enabled)("Friends deferred inference with PostgreSQL", () => {
  it("migrates only encrypted retired awards across page boundaries and is idempotent", async () => {
    const ava = await member("Ava");
    await settleAwards(ava, [
      ...Array.from({ length: 105 }, (_, index) => ({ key: `streak:${index + 1}`, kind: "streak", measureId: null,
        subjectMemberId: null, on: "2026-11-01", data: { value: index + 1, page: "streak", evaluator: 1 } })),
      { key: "total:sleep:3600", kind: "total", measureId: "sleep", subjectMemberId: null, on: "2026-11-01", data: { value: 3600, page: "totals", evaluator: 1 } },
      { key: "health:vo2Max:1", kind: "health", measureId: "vo2Max", subjectMemberId: null, on: "2026-11-01", data: { level: 1, page: "health", evaluator: 1 } },
      { key: "total:steps:1000", kind: "total", measureId: "steps", subjectMemberId: null, on: "2026-11-01", data: { value: 1000, page: "totals", evaluator: 1 } },
      ...["total", "days", "landmark", "route", "health"].map(kind => ({ key: `keep:${kind}`, kind,
        measureId: "synthetic", subjectMemberId: null, on: "2026-11-01", data: { value: 100, page: "totals", evaluator: 1 } })),
    ], async () => {});
    const kept = await readAwards(ava);
    expect(kept.map(award => award.kind).sort()).toEqual(["days", "health", "landmark", "route", "total", "total"]);
    expect(await removeRetiredProgressAwards()).toBe(107);
    expect(await readAwards(ava)).toEqual(kept);
    expect(await removeRetiredProgressAwards()).toBe(0);
    expect(await readAwards(ava)).toEqual(kept);
  });

  it.each([
    { task: "10 pushups", inferred: { name: "pushups", quantity: 10, unit: "reps" } as const, total: 60, points: [["2026-11-01", 50], ["2026-11-02", 60]] },
    { task: "Lights out by 11", inferred: { name: null, quantity: null, unit: "days" } as const, total: 40, points: [["2026-11-01", 40]] },
  ])("recovers $inferred.unit through Friends alone and settles once", async ({ task, inferred, total, points }) => {
    const { ava, leo } = await fixture(task), fetch = provider(inferred);
    const first = await readFriends();
    expect(first.status).toBe(200);
    const partial = friendsSchema.parse(await first.json());
    expect(partial.incomplete).toBe(false);
    expect(partial.rows.map(row => [row.memberId, row.total?.value])).toEqual([[ava, 120], [leo, 40]]);
    expect(await readAwards(ava)).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledTimes(1);
    await mocks.after.mock.calls[0][0]();
    expect(fetch).toHaveBeenCalledTimes(2);
    const lookup = progressLookup(leo, "task", [inference.normalizeTask(task), "photo"]);
    const cache = await db.gameProgressTaskMeasure.findMany({ where: { memberId: { in: [ava, leo] } } });
    expect(cache).toHaveLength(1);
    expect(cache[0]).toMatchObject({ memberId: leo, lookup });
    expect(await openProgress({ memberId: leo, table: "game_progress_task_measure", rowId: lookup, field: "measure" }, cache[0].measureEncrypted)).toEqual(inferred);
    await expect(openProgress({ memberId: ava, table: "game_progress_task_measure", rowId: lookup, field: "measure" }, cache[0].measureEncrypted)).rejects.toThrow();
    const second = friendsSchema.parse(await (await readFriends()).json());
    expect(second.incomplete).toBe(false);
    expect(second.rows.map(row => [row.memberId, row.total?.value, row.rank])).toEqual([[ava, 120, 1], [leo, total, 2]]);
    expect(second.chart).toEqual([{ memberId: ava, points: [["2026-11-01", 20], ["2026-11-02", 120]] }, { memberId: leo, points }]);
    expect(JSON.stringify(second)).not.toContain(task);
    // Leo hasn't done pushups on three days, so passing him isn't a medal yet.
    const awards = await readAwards(ava);
    expect(awards).toEqual([]);
    expect(friendsSchema.parse(await (await readFriends()).json())).toEqual(second);
    expect(await readAwards(ava)).toEqual(awards);
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it("keeps the same phrase member-bound in one sequential batch", async () => {
    const { ava, leo, shared } = await fixture("40 pushups");
    await entry(shared, ava, 2, null);
    const fetch = provider({ name: "pushups", quantity: 40, unit: "reps" });
    expect((await readFriends()).status).toBe(200);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    await mocks.after.mock.calls[0][0]();
    expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      "/v1/responses", "/v1/decisions", "/v1/responses", "/v1/decisions",
    ]);
    const rows = await db.gameProgressTaskMeasure.findMany({ where: { memberId: { in: [ava, leo] } } });
    expect(rows).toHaveLength(2);
    for (const memberId of [ava, leo]) {
      const lookup = progressLookup(memberId, "task", ["40 pushups", "photo"]);
      const row = rows.find(row => row.memberId === memberId)!;
      expect(row.lookup).toBe(lookup);
      expect(await openProgress({ memberId, table: "game_progress_task_measure", rowId: lookup, field: "measure" }, row.measureEncrypted))
        .toEqual({ name: "pushups", quantity: 40, unit: "reps" });
    }
  });

  it("shows a photo-only friend immediately, then stores the read's inference under that friend", async () => {
    const { ava, leo } = await fixture("10 pushups");
    await db.gameEntry.deleteMany({ where: { memberId: leo, kind: "reps" } });
    const fetch = provider({ name: "pushups", quantity: 10, unit: "reps" });
    const first = friendsSchema.parse(await (await readFriends()).json());
    expect(first.incomplete).toBe(false);
    expect(first.rows.map(row => [row.memberId, row.total?.value])).toEqual([[ava, 120], [leo, 0]]);
    expect(first.pills.map(pill => pill.id)).toContain("pushups.reps");
    expect(await readAwards(ava)).toEqual([]);
    await mocks.after.mock.calls[0][0]();
    expect(fetch).toHaveBeenCalledTimes(2);
    const lookup = progressLookup(leo, "task", ["10 pushups", "photo"]);
    const row = await db.gameProgressTaskMeasure.findUniqueOrThrow({ where: { memberId_lookup: { memberId: leo, lookup } } });
    expect(await openProgress({ memberId: leo, table: "game_progress_task_measure", rowId: lookup, field: "measure" }, row.measureEncrypted))
      .toEqual({ name: "pushups", quantity: 10, unit: "reps" });
    const second = friendsSchema.parse(await (await readFriends()).json());
    expect(second.rows.map(row => [row.memberId, row.total?.value])).toEqual([[ava, 120], [leo, 20]]);
    expect(JSON.stringify(second)).not.toContain("10 pushups");
    expect(await db.gameProgressTaskMeasure.count({ where: { memberId: leo } })).toBe(1);
  });

  it.each(["departure", "block", "session"])("writes no cache when %s removes authority during classification", async loss => {
    const { ava, leo, shared, sessionId } = await fixture("10 pushups");
    provider({ name: "pushups", quantity: 10, unit: "reps" });
    expect((await readFriends()).status).toBe(200);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    const seal = await import("../src/lib/game/progress/crypto");
    const originalSeal = seal.sealProgressMany;
    vi.spyOn(seal, "sealProgressMany").mockImplementation(async (...args) => {
      const encrypted = await originalSeal(...args);
      await db.$transaction(async tx => {
        await lockGamePair(tx, ava, leo);
        if (loss === "departure") await tx.gamePlayer.update({ where: { gameId_memberId: { gameId: shared, memberId: leo } }, data: { leftAt: new Date() } });
        else if (loss === "block") await tx.gameBlock.create({ data: { blockerMemberId: leo, blockedMemberId: ava } });
        else await tx.hostedAuthRecord.delete({ where: { model_id: { model: "session", id: sessionId } } });
      });
      return encrypted;
    });
    await expect(mocks.after.mock.calls[0][0]()).rejects.toMatchObject({ code: loss === "session" ? "UNAUTHENTICATED" : "PROGRESS_FRIENDS_CHANGED" });
    expect(await db.gameProgressTaskMeasure.count({ where: { memberId: { in: [ava, leo] } } })).toBe(0);
    expect(await readAwards(ava)).toEqual([]);
  });
});
