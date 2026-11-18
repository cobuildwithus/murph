import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import type { TermWords } from "../src/lib/game/rules";

const mocks = vi.hoisted(() => ({ games: vi.fn(), entries: vi.fn(), tasks: vi.fn(), states: vi.fn(), awards: vi.fn(),
  createAwards: vi.fn(), updateSeen: vi.fn(), patch: vi.fn(), after: vi.fn(), auth: vi.fn(), current: vi.fn(), health: vi.fn(), transaction: vi.fn(), suggest: vi.fn(), pictures: vi.fn(), resolveRoute: vi.fn(), consume: vi.fn() }));
vi.mock("@/src/lib/better-auth/rate-limit", () => ({ hostedAuthRateLimitStorage: () => ({ consume: mocks.consume }) }));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({
  game: { findMany: mocks.games }, gameEntry: { findMany: mocks.entries },
  gameProfile: { findUniqueOrThrow: async () => ({ timeZone: "UTC", createdAt: new Date("2026-11-01T12:00:00Z") }) },
  gameProgressTaskMeasure: { findMany: mocks.tasks }, gameProgressMeasure: { findMany: mocks.states },
  gameProgressAward: { findMany: mocks.awards }, gameProgressPic: { findMany: mocks.pictures }, $transaction: mocks.transaction,
}) }));
vi.mock("@/src/lib/game/http/auth", () => ({ requireGameMemberAuth: mocks.auth, assertGameMemberAuthCurrentTx: mocks.current }));
vi.mock("@/src/lib/browser-vault/authority", () => ({ assertBrowserVaultMemberAuthority: mocks.health }));
vi.mock("@/src/lib/game/progress/settlement", () => ({ scheduleProgressSettlement: vi.fn() }));
vi.mock("@/src/lib/game/progress/state", () => ({ patchMeasureState: mocks.patch }));
vi.mock("@/src/lib/game/progress/mapbox", () => ({ resolveRoute: mocks.resolveRoute }));
vi.mock("@/src/lib/game/progress/infer", async original => ({ ...await original<typeof import("../src/lib/game/progress/infer")>(),
  inferenceClient: () => ({ responses: { create: mocks.suggest } }) }));
// Keep the test port's sealed content opaque to the rows and exercise the production batch bindings.
vi.mock("@/src/lib/game/crypto", () => ({ openGameTexts: async (entries: { value: string }[]) => entries.map(entry => entry.value) }));

import { GET } from "../app/api/game/v1/progress/route";
import { GET as goals } from "../app/api/game/v1/progress/goals/route";
import { PUT } from "../app/api/game/v1/progress/measures/[id]/route";
import { POST } from "../app/api/game/v1/progress/seen/route";
import { progressSchema, goalsSchema } from "../src/lib/game/progress/contract";
import { progressLookup, sealProgress } from "../src/lib/game/progress/crypto";
import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";
import { normalizeTask } from "../src/lib/game/progress/infer";
import { ladder } from "../src/lib/game/progress/bank";
import { encodePolyline } from "../src/lib/game/progress/route-geometry";
import type { MeasureState } from "../src/lib/game/progress/state";

const memberId = "member-ava";
const request = (path = "", body?: object) => new Request(`https://example.test/api/game/v1/progress${path}`, { method: body ? "POST" : "GET",
  ...(body ? { body: JSON.stringify(body) } : {}) });
function gameRow(id = "game-one") {
  const words: TermWords = { v: 1, versions: [{ n: 1, tasks: [{ seat: 0, text: "40 pushups" }], stakes: [] }] };
  return { id, createdBy: memberId, wordsOwnerMemberId: memberId, status: "live", maxPlayers: 2, lengthDays: 7,
    startsOn: new Date("2026-11-01"), settledAt: null, devClockOffsetMs: null, events: [],
    terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { count: 7 }, stakes: [] }] },
    termsWordsEncrypted: JSON.stringify(words),
    players: [{ memberId, seat: 0, dayOne: new Date("2026-11-01"), timeZone: "UTC", joinedAt: new Date("2026-11-01T12:00:00Z"), leftAt: null }] };
}
function entryRow(day = 0) {
  return { id: `post-${day}`, gameId: "game-one", memberId, dayIndex: day, attempt: 1, kind: "reps", incomplete: null,
    receivedAt: new Date("2026-11-01T12:00:00Z"), withdrawnAt: null,
    payloadEncrypted: JSON.stringify({ exercise: "pushups", count: 40, reps: [] }) };
}
type AwardRow = Prisma.GameProgressAwardCreateManyInput;
const routeLeg = { from: "London", to: "Paris", distanceM: 1000,
  polyline: encodePolyline([[0, 50], [2, 49]]), towns: [], straightLine: false, startTotal: 0 };
async function savedRoute(state: MeasureState) {
  const lookup = progressLookup(memberId, "measure", ["walk.meters"]);
  mocks.states.mockResolvedValue([{ lookup, stateEncrypted: await sealProgress({ memberId,
    table: "game_progress_measure", rowId: lookup, field: "state" }, state) }]);
}
const routeEntry = () => ({ ...entryRow(), kind: "route", payloadEncrypted: JSON.stringify({ activity: "walk", distanceM: 1000, durationSec: 600 }) });
let awards: AwardRow[];
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  awards = [];
  mocks.consume.mockResolvedValue({ allowed: true });
  mocks.auth.mockResolvedValue({ member: { id: memberId } }); mocks.current.mockResolvedValue(undefined); mocks.health.mockResolvedValue(undefined);
  mocks.games.mockResolvedValue([gameRow()]); mocks.entries.mockResolvedValue([entryRow()]); mocks.tasks.mockResolvedValue([]); mocks.states.mockResolvedValue([]);
  mocks.pictures.mockResolvedValue([]);
  mocks.awards.mockImplementation(async () => [...awards].sort((a, b) => String(b.earnedOn).localeCompare(String(a.earnedOn)) || b.lookup.localeCompare(a.lookup)));
  mocks.createAwards.mockImplementation(async ({ data }: { data: AwardRow[] }) => {
    for (const row of data) if (!awards.some(award => award.lookup === row.lookup)) awards.push(row);
  });
  mocks.transaction.mockImplementation(async (run: (tx: object) => Promise<void>) => run({ gameProgressAward: { createMany: mocks.createAwards, updateMany: mocks.updateSeen } }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("Progress HTTP contracts", () => {
  it.each([
    { distance: 501, total: 116, distanceText: "501 miles", detail: "By road. You're 116 in, so 385 to go.", straightLine: false },
    { distance: 8.4, total: 1.2, distanceText: "8.4 miles", detail: "By road. You're 1.2 in, so 7.2 to go.", straightLine: false },
    { distance: 31240, total: 10000, distanceText: "31,240 miles", detail: "By road. You're 10k in, so 21.2k to go.", straightLine: false },
    { distance: 10, total: 11, distanceText: "10 miles", detail: "By road. You're 11 in, so 0 to go.", straightLine: false },
    { distance: 3459, total: 116, distanceText: "3,459 miles", detail: "As the crow flies. No road crosses the ocean, so Murph counts the straight line.", straightLine: true },
  ])("previews $distance miles using the canonical $total-mile total", async ({ distance, total, distanceText, detail, straightLine }) => {
    mocks.entries.mockResolvedValue([{ ...routeEntry(), payloadEncrypted: JSON.stringify({ activity: "walk", distanceM: total * 1609.344, durationSec: 600 }) }]);
    mocks.resolveRoute.mockResolvedValue({ ...routeLeg, distanceM: distance * 1609.344, straightLine,
      towns: straightLine ? [] : [{ name: "Town", atM: 1.2 * 1609.344 }] });
    const response = await goals(request("/goals?measure=walk.meters&q=London%20to%20Paris"));
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = goalsSchema.parse(await response.json());
    expect(body).toMatchObject({ note: null, route: { from: "London", to: "Paris", distanceText, detail, straightLine,
      map: "/api/game/v1/progress/map?from=London&to=Paris&size=card" } });
    expect(body.route!.towns).toEqual(straightLine ? [] : [{ name: "Town", atText: "mile 1.2", aheadText: "1.2 mi to go", x: expect.any(Number), y: expect.any(Number), passedOn: null }]);
    expect(mocks.resolveRoute).toHaveBeenCalledExactlyOnceWith("London", "Paris");
    expect(mocks.patch).not.toHaveBeenCalled(); expect(mocks.createAwards).not.toHaveBeenCalled();
  });

  it("freezes one resolved first route for both distance measures without marking it picked", async () => {
    mocks.entries.mockResolvedValue([routeEntry(), { ...entryRow(1), kind: "route", payloadEncrypted: JSON.stringify({ activity: "run", distanceM: 500, durationSec: 300 }) }]);
    mocks.resolveRoute.mockResolvedValue({ ...routeLeg, distanceM: 100000 });
    mocks.patch.mockImplementation(async (_member, _id, patch: (state: MeasureState) => Partial<MeasureState>) => patch({}));
    const response = await GET(request());
    expect(response.status).toBe(200);
    const view = progressSchema.parse(await response.json());
    expect(view.measures).toHaveLength(2);
    expect(view.measures.every(measure => measure.route !== null && !measure.route.goalPicked)).toBe(true);
    expect(mocks.resolveRoute).toHaveBeenCalledTimes(1); expect(mocks.patch).toHaveBeenCalledTimes(2);
  });
  it("keeps a completed route and its original medal after the final source post is withdrawn", async () => {
    const entry = routeEntry(); mocks.entries.mockResolvedValue([entry]);
    await savedRoute({ legs: [routeLeg] });
    const before = progressSchema.parse(await (await GET(request())).json());
    const medal = before.medals.find(medal => medal.kind === "route")!;
    expect(medal).toMatchObject({ earnedOn: "2026-11-01", face: { drawing: "route" }, title: "Paris" });
    expect(before.measures[0].route).toMatchObject({ progress: 1, finishedOn: "2026-11-01" });
    mocks.entries.mockResolvedValue([{ ...entry, withdrawnAt: new Date() }]);
    const after = progressSchema.parse(await (await GET(request())).json());
    expect(after.measures[0]).toMatchObject({ total: { value: 0 }, route: { progress: 1, finishedOn: "2026-11-01" } });
    expect(after.medals.find(item => item.id === medal.id)).toEqual(medal);
    expect(mocks.resolveRoute).not.toHaveBeenCalled();
  });
  it("composes only a picture's own measure pin and stops all settlement at the picture cap", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    mocks.pictures.mockResolvedValue([{ id, takenAt: new Date("2026-11-02T12:00:00Z"),
      metaEncrypted: await sealProgress({ memberId, table: "game_progress_pic", rowId: id, field: "meta" }, { measureId: "pushups.reps" }) }]);
    const view = progressSchema.parse(await (await GET(request())).json());
    expect(view.measures[0].pics).toEqual([{ id, takenOn: "2026-11-02", at: 40 }]);
    expect(view.picCount).toBe(1);
    mocks.transaction.mockClear(); mocks.pictures.mockResolvedValue(Array.from({ length: 10001 }, () => ({ id })));
    expect(progressSchema.parse(await (await GET(request())).json()).incomplete).toBe(true);
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.resolveRoute).not.toHaveBeenCalled();
  });
  it("resolves a checked bank route through the same setter and rolls over at the current total", async () => {
    mocks.entries.mockResolvedValue([routeEntry()]); await savedRoute({ legs: [routeLeg] });
    mocks.resolveRoute.mockImplementation(async (from: string, to: string) => ({ ...routeLeg, from, to, distanceM: 2000 }));
    mocks.patch.mockImplementation(async (_member, _id, patch: (state: MeasureState) => Partial<MeasureState>) => {
      const state = patch({ legs: [routeLeg] }); await savedRoute(state); return state;
    });
    const response = await PUT(request("/measures/walk.meters", { goal: { rungId: "boston-to-nyc" } }), { params: Promise.resolve({ id: "walk.meters" }) });
    expect(response.status).toBe(200);
    expect((await response.json()).measure.route).toMatchObject({ name: "Boston to New York", progress: 0, goalPicked: true });
    expect(mocks.resolveRoute).toHaveBeenCalledExactlyOnceWith("Boston", "New York");
  });
  it("returns route tiles and a typed preview without offering non-place routes", async () => {
    mocks.entries.mockResolvedValue([routeEntry()]);
    mocks.resolveRoute.mockResolvedValue(routeLeg);
    const response = await goals(request("/goals?measure=walk.meters&q=London%20to%20Paris"));
    const view = goalsSchema.parse(await response.json());
    expect(view.route).toMatchObject({ from: "London", to: "Paris", straightLine: false });
    expect(view.tiles.every(tile => tile.id === "around-iceland" || tile.name.split(" to ").length === 2)).toBe(true);
    expect(view.tiles.some(tile => ["to-the-moon", "5k"].includes(tile.id))).toBe(false);
    expect(mocks.patch).not.toHaveBeenCalled(); expect(mocks.suggest).not.toHaveBeenCalled();
  });
  it("builds the before-game screen without retired streak fields", async () => {
    mocks.games.mockResolvedValue([]); mocks.entries.mockResolvedValue([]);
    expect(await (await GET(request())).json()).toEqual({ joinedOn: "2026-11-01", today: "2026-11-05", incomplete: false,
      measures: [], medals: [], shelf: [], moments: [], picCount: 0 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("returns a private complete response and settles the same crossing only once", async () => {
    mocks.entries.mockResolvedValue([{ ...entryRow(), payloadEncrypted: JSON.stringify({ exercise: "pushups", count: 100, reps: [] }) }]);
    const first = await GET(request());
    expect(first.status).toBe(200); expect(first.headers.get("Cache-Control")).toBe("private, no-store");
    const view = progressSchema.parse(await first.json());
    expect(view.measures[0]).toMatchObject({ id: "pushups.reps", pending: false, total: { value: 100 } });
    expect(mocks.after).not.toHaveBeenCalled();
    const original = structuredClone(awards);
    mocks.awards.mockClear();
    expect(progressSchema.parse(await (await GET(request())).json())).toEqual(view);
    expect(mocks.awards).toHaveBeenCalledOnce();
    expect(awards).toEqual(original);
    expect(mocks.current).toHaveBeenCalled();
    expect(mocks.games).toHaveBeenCalledWith(expect.objectContaining({ take: 501 }));
    expect(mocks.entries).toHaveBeenCalledWith(expect.objectContaining({ take: 10001, where: expect.objectContaining({ memberId }) }));
  });
  it("rereads an insert lost to another writer and renders its seen state", async () => {
    mocks.entries.mockResolvedValue([{ ...entryRow(), payloadEncrypted: JSON.stringify({ exercise: "pushups", count: 100, reps: [] }) }]);
    mocks.createAwards.mockImplementationOnce(({ data }: { data: AwardRow[] }) => {
      awards.push(...data.map(row => ({ ...row, seenAt: new Date() })));
      return { count: 0 };
    });
    const response = progressSchema.parse(await (await GET(request())).json());
    expect(mocks.createAwards).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ skipDuplicates: true }));
    expect(response.medals).toHaveLength(awards.length);
    expect(response.medals.length).toBeGreaterThan(0);
    expect(response.moments).toEqual([]);
    expect(mocks.awards).toHaveBeenCalledTimes(2);
  });
  it.each([8, 10])("supplies each exercise's latest total medal or next coin at %s minutes", async minutes => {
    const planks = gameRow("game-planks");
    const words = `${minutes} min planks`;
    planks.termsWordsEncrypted = JSON.stringify({ v: 1, versions: [{ n: 1, tasks: [{ seat: 0, text: words }], stakes: [] }] });
    mocks.games.mockResolvedValue([gameRow(), planks]);
    mocks.entries.mockResolvedValue([
      { ...entryRow(), payloadEncrypted: JSON.stringify({ exercise: "pushups", count: 1000, reps: [] }) },
      { ...entryRow(1), id: "burpees", payloadEncrypted: JSON.stringify({ exercise: "burpees", count: 40, reps: [] }) },
      { ...entryRow(), id: "planks", gameId: planks.id, kind: "photo", payloadEncrypted: null },
    ]);
    const lookup = progressLookup(memberId, "task", [words, "photo"]);
    mocks.tasks.mockResolvedValue([{ lookup, measureEncrypted: await sealProgress({ memberId,
      table: "game_progress_task_measure", rowId: lookup, field: "measure" }, { quantity: minutes, unit: "minutes", name: "planks" }) }]);
    const view = progressSchema.parse(await (await GET(request())).json());
    const totals = view.medals.filter(medal => medal.kind === "total");
    expect(totals.filter(medal => medal.open.measureId === "pushups.reps").map(medal => medal.face))
      .toEqual([{ number: "1,000" }, { number: "500" }, { number: "200" }, { number: "100" }]);
    expect(totals.filter(medal => medal.open.measureId === "planks.seconds").map(medal => medal.face))
      .toEqual(minutes === 8 ? [] : [{ number: "10m" }]);
    expect(view.measures.find(measure => measure.id === "planks.seconds"))
      .toMatchObject({ total: { value: minutes * 60 }, projection: { value: minutes === 8 ? 600 : 900 } });
    expect(totals.some(medal => medal.open.measureId === "burpees.reps")).toBe(false);
    expect(view.measures.find(measure => measure.id === "burpees.reps")?.projection?.value).toBe(100);
    expect(view.shelf.every(id => view.medals.some(medal => medal.id === id))).toBe(true);
    expect(view.shelf).toContain(view.medals.find(medal => medal.gold)!.id);
    expect(new Set(view.medals.map(medal => medal.id)).size).toBe(view.medals.length);
    expect(view).not.toHaveProperty("streak");
    expect(view.medals.some(medal => medal.kind === "streak")).toBe(false);
  });
  it("shows the highest stored total on the shelf despite out-of-order earned dates", async () => {
    mocks.entries.mockResolvedValue([]);
    for (const [value, on] of [[100, "2026-11-05"], [200, "2026-11-01"], [500, "2026-11-02"]] as const) {
      const key = `total:pushups.reps:${value}`;
      const lookup = progressLookup(memberId, "award", [key]);
      awards.push({ memberId, lookup, earnedOn: new Date(on), createdAt: new Date(), seenAt: null,
        dataEncrypted: await sealProgress({ memberId, table: "game_progress_award", rowId: lookup, field: "data" }, {
          key, kind: "total", measureId: "pushups.reps", subjectMemberId: null, on,
          data: { value, unit: "reps", noun: "pushups", page: "totals" },
        }) });
    }
    const original = structuredClone(awards);
    const view = progressSchema.parse(await (await GET(request())).json());
    expect(view.medals.map(medal => [medal.title, medal.earnedOn])).toEqual([
      ["500", "2026-11-02"], ["200", "2026-11-01"], ["100", "2026-11-05"],
    ]);
    expect(view.shelf).toEqual([view.medals[0].id]);
    expect(view.medals.filter(medal => medal.gold).map(medal => medal.title)).toEqual(["500"]);
    expect(awards).toEqual(original);
  });
  it("waits for pending task inference before settling the full history's crossing dates", async () => {
    const game = gameRow();
    game.termsWordsEncrypted = JSON.stringify({ v: 1, versions: [{ n: 1, tasks: [{ seat: 0, text: "250 pushups" }], stakes: [] }] });
    mocks.games.mockResolvedValue([game]);
    mocks.entries.mockResolvedValue([
      { ...entryRow(), kind: "photo", payloadEncrypted: null },
      { ...entryRow(2), payloadEncrypted: JSON.stringify({ exercise: "pushups", count: 100, reps: [] }) },
    ]);
    const pending = progressSchema.parse(await (await GET(request())).json());
    expect(pending.measures.find(measure => measure.id === "pushups.reps")?.total.value).toBe(100);
    expect(pending.measures.some(measure => measure.pending)).toBe(true);
    expect(pending.medals).toEqual([]);
    expect(mocks.createAwards).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledTimes(1);

    const lookup = progressLookup(memberId, "task", ["250 pushups", "photo"]);
    mocks.tasks.mockResolvedValue([{ lookup, measureEncrypted: await sealProgress({ memberId,
      table: "game_progress_task_measure", rowId: lookup, field: "measure" }, { quantity: 250, unit: "reps", name: "pushups" }) }]);
    const resolved = progressSchema.parse(await (await GET(request())).json());
    expect(resolved.measures).toHaveLength(1);
    expect(resolved.measures[0]).toMatchObject({ pending: false, total: { value: 350 } });
    expect(resolved.medals.filter(medal => medal.kind === "total").map(medal => [medal.title, medal.earnedOn]))
      .toEqual([["200", "2026-11-01"], ["100", "2026-11-01"]]);
    const original = structuredClone(awards);
    await GET(request());
    expect(awards).toEqual(original);
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });
  it.each(["games", "entries"])("marks %s overflow incomplete and makes no settling or inference writes", async cap => {
    if (cap === "games") mocks.games.mockResolvedValue(Array.from({ length: 501 }, (_, i) => gameRow(`game-${i}`)));
    else mocks.entries.mockResolvedValue(Array.from({ length: 10001 }, (_, i) => ({ ...entryRow(0), id: `entry-${i}` })));
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(progressSchema.parse(await response.json()).incomplete).toBe(true);
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.after).not.toHaveBeenCalled();
  });
  it("keeps passed landmarks even after the final contributing post is withdrawn", async () => {
    const entry = { ...entryRow(), payloadEncrypted: JSON.stringify({ exercise: "pushups", count: 100, reps: [] }) };
    mocks.entries.mockResolvedValue([entry]);
    const before = progressSchema.parse(await (await GET(request())).json());
    const passed = before.measures[0].ladder!.passed;
    expect(passed.length).toBeGreaterThan(0);
    mocks.entries.mockResolvedValue([{ ...entry, withdrawnAt: new Date() }]);
    const after = progressSchema.parse(await (await GET(request())).json());
    expect(after.measures[0].total.value).toBe(0);
    expect(after.measures[0].ladder!.passed).toEqual(passed);
    expect(after.measures[0].ladder!.next!.id).toBe(before.measures[0].ladder!.next!.id);
    expect(after.measures[0].ladder!.next!.toGo).toBe("125 to go");
    expect(after.medals).toEqual(before.medals);
    expect((await goals(request("/goals?measure=pushups.reps"))).status).toBe(200);
    expect((await PUT(request("/measures/pushups.reps", { goal: { rungId: "half-dome" } }), { params: Promise.resolve({ id: "pushups.reps" }) })).status).toBe(200);
  });
  it("resolves group defaults and seat overrides at their historical terms revisions", async () => {
    const row = gameRow(); row.maxPlayers = 10;
    row.terms.versions.push({ n: 2, fromDay: 1, schedule: { count: 7 }, stakes: [] });
    row.termsWordsEncrypted = JSON.stringify({ v: 1, versions: [
      { n: 1, defaultTask: "20 squats", tasks: [{ seat: 1, text: "100 pushups" }], stakes: [] },
      { n: 2, defaultTask: "20 squats", tasks: [{ seat: 0, text: "10 min abs" }], stakes: [] },
    ] });
    mocks.games.mockResolvedValue([row]);
    mocks.entries.mockResolvedValue([0, 1].map(day => ({ ...entryRow(day), kind: "photo", payloadEncrypted: null })));
    const cached = [];
    for (const [text, name, quantity, unit] of [["20 squats", "squats", 20, "reps"], ["10 min abs", "abs", 10, "minutes"]] as const) {
      const lookup = progressLookup(memberId, "task", [normalizeTask(text), "photo"]);
      cached.push({ lookup, measureEncrypted: await sealProgress({ memberId, table: "game_progress_task_measure", rowId: lookup, field: "measure" }, { name, quantity, unit }) });
    }
    mocks.tasks.mockResolvedValue(cached);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(progressSchema.parse(await response.json()).measures.map(measure => [measure.id, measure.total.value])).toEqual([["squats.reps", 20], ["abs.seconds", 600]]);
  });
  it("uses the terminal event in the game's shifted clock without dropping earlier history", async () => {
    const row = { ...gameRow(), status: "void", devClockOffsetMs: BigInt(86_400_000), events: [{ createdAt: new Date("2026-11-02T12:00:00Z") }] };
    mocks.games.mockResolvedValue([row]); mocks.entries.mockResolvedValue([entryRow(0), entryRow(2)]);
    const view = progressSchema.parse(await (await GET(request())).json());
    expect(view.measures[0].total.value).toBe(80);
  });
  it("uses the departing peer's already-shifted time for a void group's surviving member", async () => {
    const row = { ...gameRow(), status: "void", maxPlayers: 10, devClockOffsetMs: BigInt(86_400_000) };
    const peer = { ...row.players[0], memberId: "member-leo", seat: 1, leftAt: new Date("2026-11-03T12:00:00Z") };
    mocks.games.mockResolvedValue([{ ...row, players: [peer, ...row.players] }]);
    mocks.entries.mockResolvedValue([entryRow(0), entryRow(2)]);
    const view = progressSchema.parse(await (await GET(request())).json());
    expect(view.measures[0].total.value).toBe(80);
  });
  it("schedules only unresolved untyped phrases after the response, with member and kind bound lookups", async () => {
    mocks.entries.mockResolvedValue([0, 1].map(day => ({ ...entryRow(day), kind: "photo", payloadEncrypted: null })));
    const response = await GET(request());
    const view = progressSchema.parse(await response.json());
    expect(view.measures[0]).toMatchObject({ pending: true, total: { value: 2, unit: "days" }, ladder: null });
    expect(view.medals.some(medal => medal.open.measureId === view.measures[0].id)).toBe(false);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    const lookup = progressLookup(memberId, "task", ["40 pushups", "photo"]);
    expect(lookup).not.toBe(progressLookup("member-leo", "task", ["40 pushups", "photo"]));
    expect(lookup).not.toBe(progressLookup(memberId, "task", ["40 pushups", "any"]));
    expect(lookup).not.toBe(createHash("sha256").update("40 pushups").digest("hex"));
  });
  it("denies a session revoked between read and settlement without writing", async () => {
    mocks.entries.mockResolvedValue([{ ...entryRow(), payloadEncrypted: JSON.stringify({ exercise: "pushups", count: 100, reps: [] }) }]);
    mocks.current.mockRejectedValue(hostedOnboardingError({ code: "UNAUTHENTICATED", httpStatus: 401, message: "Sign in to continue." }));
    expect((await GET(request())).status).toBe(401);
    expect(mocks.createAwards).not.toHaveBeenCalled();
  });
  it("filters stored health medals and moments when current Postgres authority denies access", async () => {
    mocks.entries.mockResolvedValue([{ ...entryRow(), payloadEncrypted: JSON.stringify({ exercise: "pushups", count: 100, reps: [] }) }]);
    const lookup = progressLookup(memberId, "award", ["health:one"]);
    const dataEncrypted = await sealProgress({ memberId, table: "game_progress_award", rowId: lookup, field: "data" }, {
      key: "health:one", kind: "health", measureId: "restingHeartRate", subjectMemberId: null, on: "2026-11-05",
      data: { face: { delta: { icon: "heart", text: "↓1" } }, title: "Heart rate", detail: "down 1 bpm", page: "health" },
    });
    awards.push({ memberId, lookup, earnedOn: new Date("2026-11-05"), createdAt: new Date(), seenAt: null, dataEncrypted });
    mocks.health.mockRejectedValue(hostedOnboardingError({ code: "HOSTED_CONSENT_REQUIRED", httpStatus: 403, message: "Consent required." }));
    const response = await GET(request());
    expect(response.status).toBe(200);
    const view = progressSchema.parse(await response.json());
    expect(view.medals.some(medal => medal.kind === "health")).toBe(false);
    expect(view.moments.flatMap(moment => moment.medalIds)).not.toContain(lookup);
    expect(view.medals.filter(medal => medal.gold)).toHaveLength(1);
  });
  it("marks only this owner's requested moment awards seen", async () => {
    const view = await (await GET(request())).json();
    const response = await POST(request("/seen", { momentIds: view.moments.map((moment: { id: string }) => moment.id) }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true });
    expect(mocks.updateSeen).toHaveBeenCalledWith({ where: { memberId, lookup: { in: awards.map(award => award.lookup) }, seenAt: null }, data: { seenAt: expect.any(Date) } });
  });
  it.each([{ perDay: -1 }, { perDay: 1e308 }, { perDay: 10_001 }, { perDay: 1.5 }, { goal: { rungId: "" } }, { memberId: "member-leo", perDay: 40 }])("rejects invalid measure input before storage", async body => {
    const response = await PUT(request("/measures/pushups.reps", body), { params: Promise.resolve({ id: "pushups.reps" }) });
    expect(response.status).toBe(400); expect(mocks.patch).not.toHaveBeenCalled();
  });
  it("writes a checked goal only through patchMeasureState and rejects a route on a rep measure", async () => {
    const response = await PUT(request("/measures/pushups.reps", { goal: { rungId: "half-dome" } }), { params: Promise.resolve({ id: "pushups.reps" }) });
    expect(response.status).toBe(200);
    expect(mocks.patch).toHaveBeenCalledWith(memberId, "pushups.reps", { goal: { rungId: "half-dome" } }, expect.any(Function));
    const route = await PUT(request("/measures/pushups.reps", { goal: { from: "London", to: "Paris" } }), { params: Promise.resolve({ id: "pushups.reps" }) });
    expect(route.status).toBe(400); expect(mocks.resolveRoute).not.toHaveBeenCalled();
  });
  it("returns only checked height tiles and a typed bank match", async () => {
    const response = await goals(request("/goals?measure=pushups.reps&q=Half%20Dome"));
    expect(response.status).toBe(200);
    expect(goalsSchema.parse(await response.json())).toMatchObject({ match: { id: "half-dome" }, note: null, route: null });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.suggest).not.toHaveBeenCalled();
  });
  it("offers the same curated plank ladder on Totals and goal tiles", async () => {
    const row = gameRow();
    row.termsWordsEncrypted = JSON.stringify({ v: 1, versions: [{ n: 1, tasks: [{ seat: 0, text: "10 min planks" }], stakes: [] }] });
    mocks.games.mockResolvedValue([row]); mocks.entries.mockResolvedValue([{ ...entryRow(), kind: "photo", payloadEncrypted: null }]);
    const lookup = progressLookup(memberId, "task", ["10 min planks", "photo"]);
    mocks.tasks.mockResolvedValue([{ lookup, measureEncrypted: await sealProgress({ memberId, table: "game_progress_task_measure", rowId: lookup, field: "measure" }, { name: "planks", quantity: 10, unit: "minutes" }) }]);
    const response = await goals(request("/goals?measure=planks.seconds"));
    expect(goalsSchema.parse(await response.json()).tiles.map(tile => tile.id)).toEqual(ladder("time", "plank").filter(entry => entry.at > 600).slice(0, 6).map(entry => entry.id));
  });
  it("keeps typing bank-only, including a miss", async () => {
    const response = await goals(request("/goals?measure=pushups.reps&q=Mount%20Doom"));
    expect(goalsSchema.parse(await response.json())).toMatchObject({ match: null, suggestions: [], note: null });
    expect(mocks.suggest).not.toHaveBeenCalled(); expect(mocks.consume).not.toHaveBeenCalled();
  });
  it("uses required web search only for an explicit lookup", async () => {
    mocks.suggest.mockResolvedValue({ status: "completed", output: [], output_text: JSON.stringify({ found: null, closest: ["half-dome"], note: "A real mountain to climb." }) });
    const response = await goals(request("/goals?measure=pushups.reps&q=Mount%20Doom&find=1"));
    expect(goalsSchema.parse(await response.json())).toMatchObject({ match: null, suggestions: [{ id: "half-dome" }], note: "A real mountain to climb." });
    expect(mocks.suggest).toHaveBeenCalledTimes(1);
    expect(mocks.suggest.mock.calls[0][0]).toMatchObject({ model: "gpt-6.2-sol", reasoning: { effort: "low" }, tools: [{ type: "web_search" }], tool_choice: "required", store: false, text: { format: { type: "json_schema", strict: true } } });
    const input = JSON.parse(mocks.suggest.mock.calls[0][0].input);
    expect(Object.keys(input).sort()).toEqual(["bank", "kind", "words"]);
    expect(input).toMatchObject({ kind: "height", words: "Mount Doom", bank: expect.arrayContaining([{ id: "half-dome", name: "Half Dome" }]) });
    expect(mocks.suggest.mock.calls[0][1]).toMatchObject({ maxRetries: 0, timeout: 30000 });
    expect(mocks.consume).toHaveBeenCalledExactlyOnceWith(`progress-goal-lookup:member:${memberId}`, { max: 20, window: 86400 });
  });
  it("preserves the budget's 429 with zero provider calls", async () => {
    mocks.consume.mockResolvedValue({ allowed: false });
    const response = await goals(request("/goals?measure=pushups.reps&q=Hill&find=1"));
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: { code: "AUTH_RATE_LIMITED", retryable: true } });
    expect(mocks.suggest).not.toHaveBeenCalled(); expect(mocks.patch).not.toHaveBeenCalled();
  });
  it.each([new Error("provider unavailable"), new SyntaxError("invalid JSON")])("returns the single provider 503 without a retry", async error => {
    mocks.suggest.mockRejectedValue(error);
    const response = await goals(request("/goals?measure=pushups.reps&q=Hill&find=1"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "GAME_PROGRESS_GOALS_UNAVAILABLE", retryable: true } });
    expect(mocks.suggest).toHaveBeenCalledTimes(1); expect(mocks.patch).not.toHaveBeenCalled();
  });
  it.each(["find=1", "q=Hill&find=true", "q=Hill&find=0"])("rejects malformed lookup query %s before provider work", async query => {
    expect((await goals(request(`/goals?measure=pushups.reps&${query}`))).status).toBe(400);
    expect(mocks.suggest).not.toHaveBeenCalled(); expect(mocks.consume).not.toHaveBeenCalled();
  });
  it.each(["us", "uk", "metric"])("uses the %s reader's units in route previews, totals, route medals and PUT", async units => {
    mocks.entries.mockResolvedValue([{ ...routeEntry(), payloadEncrypted: JSON.stringify({ activity: "walk", distanceM: 1609.344, durationSec: 600 }) }]);
    await savedRoute({ legs: [{ ...routeLeg, distanceM: 1609.344 }] });
    mocks.resolveRoute.mockResolvedValue({ ...routeLeg, distanceM: 1609.344, towns: [{ name: "Town", atM: 1609.344 }] });
    const header = { "X-Murph-Client-Units": units };
    const preview = goalsSchema.parse(await (await goals(new Request(request("/goals?measure=walk.meters&q=London%20to%20Paris"), { headers: header }))).json());
    const distance = units === "metric" ? "1.6 km" : "1 mi";
    expect(preview.route).toMatchObject({ distanceText: units === "metric" ? distance : "1 miles", towns: [{ atText: units === "metric" ? "km 1.6" : "mile 1" }] });
    const view = progressSchema.parse(await (await GET(new Request(request(), { headers: header }))).json());
    expect(view.measures[0]).toMatchObject({ total: { text: distance }, route: { distanceText: distance, walkedText: distance } });
    expect(view.medals.find(medal => medal.kind === "route")!.detail).toBe(`${distance} from London`);
    expect(view.medals.find(medal => medal.kind === "total")!.face).toEqual({ number: distance });
    const put = await PUT(new Request(request("/measures/walk.meters", { goal: { from: "London", to: "Paris" } }), { headers: header }), { params: Promise.resolve({ id: "walk.meters" }) });
    expect(put.status).toBe(200); expect((await put.json()).measure.total.text).toBe(distance);
  });
});
