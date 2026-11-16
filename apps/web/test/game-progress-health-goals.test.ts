import { addDaysToIsoDate } from "@murphai/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), current: vi.fn(), authority: vi.fn(), raw: vi.fn(), profile: vi.fn(),
  states: vi.fn(), state: vi.fn(), createState: vi.fn(), updateState: vi.fn(), awards: vi.fn(), createAwards: vi.fn(),
  games: vi.fn(), entries: vi.fn(), resolve: vi.fn(), render: vi.fn(), lookup: vi.fn(), consume: vi.fn() }));
const db = { gameProfile: { findUnique: mocks.profile, findUniqueOrThrow: mocks.profile },
  gameProgressMeasure: { findMany: mocks.states, findUnique: mocks.state, createMany: mocks.createState, updateMany: mocks.updateState },
  gameProgressAward: { findMany: mocks.awards, createMany: mocks.createAwards },
  game: { findMany: mocks.games }, gameEntry: { findMany: mocks.entries },
  gameProgressTaskMeasure: { findMany: async () => [] }, gameProgressPic: { findMany: async () => [] },
  $transaction: async (run: (tx: object) => Promise<unknown>) => run(db) };
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/src/lib/game/http/auth", () => ({ requireGameMemberAuth: mocks.auth, assertGameMemberAuthCurrentTx: mocks.current }));
vi.mock("@/src/lib/browser-vault/authority", () => ({ assertBrowserVaultMemberAuthority: mocks.authority }));
vi.mock("@/src/lib/device-sync/companion-numbers", async original => ({
  ...await original<typeof import("../src/lib/device-sync/companion-numbers")>(), readCompanionHealthSeries: mocks.raw }));
vi.mock("@/src/lib/game/progress/mapbox", () => ({ resolveRoute: mocks.resolve, renderRouteMap: mocks.render }));
vi.mock("@/src/lib/game/progress/infer", async original => ({ ...await original<typeof import("../src/lib/game/progress/infer")>(),
  inferenceClient: () => ({ responses: { create: mocks.lookup } }) }));
vi.mock("@/src/lib/better-auth/rate-limit", () => ({ hostedAuthRateLimitStorage: () => ({ consume: mocks.consume }) }));
import { GET as health } from "../app/api/game/v1/progress/health/route";
import { GET as progress } from "../app/api/game/v1/progress/route";
import { GET as goals } from "../app/api/game/v1/progress/goals/route";
import { GET as map } from "../app/api/game/v1/progress/map/route";
import { PUT } from "../app/api/game/v1/progress/measures/[id]/route";
import { goalsSchema, healthSchema, progressSchema, measureSchema } from "../src/lib/game/progress/contract";
import { progressLookup, sealProgress, openProgress } from "../src/lib/game/progress/crypto";
import { ladder } from "../src/lib/game/progress/bank";
import { encodePolyline } from "../src/lib/game/progress/route-geometry";
import { readGoalContext } from "../src/lib/game/progress/goal-context";
import { routeLegs } from "../src/lib/game/progress/route-progress";
import { settleAwards } from "../src/lib/game/progress/awards";
import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";
import type { MeasureState } from "../src/lib/game/progress/state";
import goalLookup from "./fixtures/progress-goal-lookup-response.json";

const memberId = "ava", joinedOn = "2026-11-01", today = "2026-11-16";
const auth = { member: { id: memberId } };
const point = (date: string, value: number) => ({ date, value, source: "Garmin", observedAt: `${date}T12:00:00Z` });
const leg = { from: "London", to: "Paris", distanceM: 1_000_000, startTotal: 0,
  polyline: encodePolyline([[0, 50], [2, 49]]), towns: [], straightLine: false };
const raw = () => ({ timeZone: "UTC", savedAt: `${today}T12:00:00Z`, freshness: "fresh",
  window: { from: "2025-11-17", through: today }, stepsWindow: { from: "2025-11-17", through: "2026-11-15" },
  demographics: null, numbers: { restingHeartRate: null, vo2Max: null,
    steps: { daily: [point("2026-11-02", 2000)] }, sleep: { daily: [point("2026-11-02", 480)] } } });
const request = (path: string, body?: object) => new Request(`https://example.test/api/game/v1/progress${path}`,
  { ...(body ? { method: "PUT", body: JSON.stringify(body) } : {}) });
const put = (id: string, body: object) => PUT(request(`/measures/${id}`, body), { params: Promise.resolve({ id }) });
let states: { memberId: string; lookup: string; stateEncrypted: string }[], awards: Prisma.GameProgressAwardCreateManyInput[];
async function saveState(id: string, state: MeasureState) {
  const lookup = progressLookup(memberId, "measure", [id]);
  states.push({ memberId, lookup, stateEncrypted: await sealProgress({ memberId, table: "game_progress_measure", rowId: lookup, field: "state" }, state) });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(`${today}T12:00:00Z`));
  states = []; awards = [];
  mocks.auth.mockResolvedValue(auth); mocks.profile.mockResolvedValue({ createdAt: new Date(`${joinedOn}T12:00:00Z`), timeZone: "UTC" });
  mocks.raw.mockResolvedValue(raw()); mocks.games.mockResolvedValue([]); mocks.entries.mockResolvedValue([]);
  mocks.states.mockImplementation(async ({ where }) => states.filter(row => where.lookup.in.includes(row.lookup)));
  mocks.state.mockImplementation(async ({ where }) => states.find(row => row.lookup === where.memberId_lookup.lookup) ?? null);
  mocks.createState.mockImplementation(async ({ data }) => { states.push(...data); return { count: data.length }; });
  mocks.updateState.mockImplementation(async ({ where, data }) => {
    const row = states.find(row => row.lookup === where.lookup && row.stateEncrypted === where.stateEncrypted);
    if (!row) return { count: 0 };
    row.stateEncrypted = data.stateEncrypted; return { count: 1 };
  });
  mocks.awards.mockImplementation(async () => [...awards].sort((a, b) =>
    String(b.earnedOn).localeCompare(String(a.earnedOn)) || b.lookup.localeCompare(a.lookup)));
  mocks.createAwards.mockImplementation(async ({ data }) => {
    for (const row of data) if (!awards.some(award => award.lookup === row.lookup)) awards.push(row);
  });
  mocks.resolve.mockResolvedValue(leg); mocks.render.mockResolvedValue(new Response(null, { headers: { "Content-Type": "image/png" } }));
  mocks.consume.mockResolvedValue({ allowed: true }); mocks.lookup.mockResolvedValue(goalLookup);
});
afterEach(() => vi.useRealTimers());

describe("own health goal contracts with zero games", () => {
  it.each(["steps", "sleep"])("previews %s without baseline, route initialization or settlement", async id => {
    const response = await goals(request(`/goals?measure=${id}`));
    expect(response.status).toBe(200);
    const result = goalsSchema.parse(await response.json());
    expect(result.tiles.length).toBeGreaterThan(0);
    if (id === "sleep") expect(result.tiles.map(tile => tile.id)).toEqual(ladder("time", "sleep").filter(rung => rung.at > 480 * 60).slice(0, 6).map(rung => rung.id));
    expect(states).toEqual([]); expect(awards).toEqual([]); expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.raw).toHaveBeenCalledTimes(1); expect(mocks.games).not.toHaveBeenCalled();
  });
  it("returns the changed Sleep measure from the same read and settles only on the normal refresh", async () => {
    const rung = ladder("time", "sleep").at(-1)!;
    const response = await put("sleep", { goal: { rungId: rung.id } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    const measure = measureSchema.parse(body.measure);
    expect(measure).toMatchObject({ id: "sleep", source: "wearable", gameOn: false, needsPerDay: false, pics: [],
      total: { value: 28800, unit: "seconds" }, ladder: { next: { id: rung.id } } });
    expect(mocks.raw).toHaveBeenCalledTimes(1); expect(mocks.games).not.toHaveBeenCalled(); expect(awards).toEqual([]);
    expect(mocks.authority.mock.calls.some(([input]) => input.prisma === db)).toBe(true);
  });
  it("starts the chosen Steps route at the admitted total and retains an awarded completed leg after correction", async () => {
    const completed = { ...leg, distanceM: 1609.344 };
    await saveState("steps", { legs: [completed] });
    await settleAwards(memberId, routeLegs({ measureId: "steps", legs: [completed], points: [[joinedOn, 2000]] }), async () => {});
    mocks.raw.mockResolvedValue({ ...raw(), numbers: { ...raw().numbers, steps: { daily: [point(today, 1000)] } } });
    const response = await put("steps", { goal: { from: "Paris", to: "Lyon" } });
    expect(response.status).toBe(200);
    const result = measureSchema.parse((await response.json()).measure);
    expect(result.total.value).toBe(1000); expect(result.route?.completed).toHaveLength(1);
    const row = states[0];
    const state = await openProgress<MeasureState>({ memberId, table: "game_progress_measure", rowId: row.lookup, field: "state" }, row.stateEncrypted);
    expect(state.legs).toEqual([completed, { ...leg, startTotal: 804.672 }]);
    expect(mocks.raw).toHaveBeenCalledTimes(1); expect(mocks.resolve).toHaveBeenCalledTimes(1); expect(mocks.games).not.toHaveBeenCalled();
  });
  it.each(["steps", "sleep"])("rejects perDay for %s", async id => {
    expect((await put(id, { perDay: 40 })).status).toBe(400); expect(states).toEqual([]); expect(awards).toEqual([]);
  });
  it.each([
    { label: "missing replica", daily: null }, { label: "empty series", daily: [] },
    { label: "prejoin only", daily: [point("2026-10-31", 480)] },
  ])("withholds goals without postjoin input: $label", async ({ daily }) => {
    mocks.raw.mockResolvedValue(daily === null ? null : { ...raw(), numbers: { ...raw().numbers, sleep: { daily } } });
    for (const response of [await goals(request("/goals?measure=sleep")), await put("sleep", { goal: { rungId: "apollo-11" } })]) {
      expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ error: { code: "PROGRESS_HEALTH_UNAVAILABLE", retryable: true } });
    }
    expect(states).toEqual([]); expect(awards).toEqual([]);
  });
  it.each(["session", "health"])("denies %s loss at private read completion and in the write transaction", async boundary => {
    const check = boundary === "session" ? mocks.current : mocks.authority;
    const denial = hostedOnboardingError({ code: "CONSENT_REQUIRED", httpStatus: 403, message: "Consent required." });
    check.mockRejectedValueOnce(denial);
    expect((await goals(request("/goals?measure=sleep"))).status).toBe(403);
    check.mockResolvedValueOnce(undefined).mockRejectedValueOnce(denial);
    expect((await put("steps", { goal: { from: "London", to: "Paris" } })).status).toBe(403);
    expect(states).toEqual([]); expect(awards).toEqual([]);
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
  });
  it("rechecks health authority inside explicit lookup writes", async () => {
    mocks.authority.mockResolvedValueOnce(undefined).mockRejectedValueOnce(hostedOnboardingError({ code: "CONSENT_REQUIRED", httpStatus: 403, message: "Consent required." }));
    const response = await goals(request("/goals?measure=sleep&q=long%20journey&find=1"));
    expect(response.status).toBe(403); expect(mocks.lookup).toHaveBeenCalledTimes(1); expect(states).toEqual([]);
  });
  it.each(["/goals?measure=steps&memberId=leo", "/goals?measure=sleep&with=leo"])("rejects foreign selectors: %s", async path => {
    expect((await goals(request(path))).status).toBe(400); expect(mocks.raw).not.toHaveBeenCalled();
  });
});

it("Health, goal context and PNG admit the same bounded points, and saved completion survives corrections", async () => {
  const daily = [point("2025-11-16", 9000), point("2026-10-31", 9000), point("2026-11-01", -1),
    point("2026-11-02", 1_000_001), point("2026-11-03", 1_000_000), point("2026-11-05", 2000), point("2026-11-17", 9000)];
  mocks.raw.mockResolvedValue({ ...raw(), numbers: { ...raw().numbers, steps: { daily } } });
  await saveState("steps", { legs: [leg] });
  const body = healthSchema.parse(await (await health(request("/health"))).json());
  expect(body.sums.find(sum => sum.id === "steps")?.points).toEqual([["2026-11-03", 1_000_000], ["2026-11-05", 1_002_000]]);
  const context = await readGoalContext(await mocks.auth(), "steps", new AbortController().signal);
  expect(context.measure.amounts.map(day => [day.date, day.amount])).toEqual([["2026-11-03", 1_000_000], ["2026-11-05", 2000]]);
  mocks.raw.mockClear(); mocks.createAwards.mockClear(); mocks.createState.mockClear(); mocks.updateState.mockClear();
  expect((await map(request("/map?measure=steps&size=card"))).status).toBe(200);
  expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ progress: body.sums.find(sum => sum.id === "steps")!.route!.progress }));
  expect(mocks.raw).toHaveBeenCalledTimes(1); expect(mocks.createAwards).not.toHaveBeenCalled();
  expect(mocks.createState).not.toHaveBeenCalled(); expect(mocks.updateState).not.toHaveBeenCalled();
  expect(mocks.resolve).not.toHaveBeenCalled();
  await settleAwards(memberId, routeLegs({ measureId: "steps", legs: [leg], points: [["2026-11-05", 2_000_000]] }), async () => {});
  mocks.raw.mockResolvedValue({ ...raw(), numbers: { ...raw().numbers, steps: { daily: [point("2026-11-05", 1)] } } });
  await map(request("/map?measure=steps&size=card"));
  expect(mocks.render).toHaveBeenLastCalledWith(expect.objectContaining({ progress: 1 }));
});

it("a zero-game Health then Progress refresh exposes both sums and stable earned medals, then hides all health kinds on authority loss", async () => {
  mocks.raw.mockResolvedValue({ ...raw(), demographics: { birthYear: 1991, biologicalSex: "female" },
    numbers: { ...raw().numbers, steps: { daily: Array.from({ length: 43 }, (_, i) => {
      const date = addDaysToIsoDate(joinedOn, i - 28); return point(date, date < joinedOn ? 100 : 100_000);
    }) } } });
  mocks.resolve.mockResolvedValue({ ...leg, distanceM: 1609.344 });
  const first = healthSchema.parse(await (await health(request("/health"))).json());
  expect(first.sums.map(sum => sum.id)).toEqual(["steps", "sleep"]);
  const view = progressSchema.parse(await (await progress(request(""))).json());
  expect(view.measures).toEqual([]); expect(view.medals.map(medal => medal.kind)).toEqual(expect.arrayContaining(["total", "time", "route", "health", "healthAge"]));
  expect(view.medals.every(medal => ["steps", "sleep"].includes(medal.open.measureId!))).toBe(true);
  await health(request("/health"));
  const second = progressSchema.parse(await (await progress(request(""))).json());
  expect(second.medals).toEqual(view.medals); expect(mocks.raw).toHaveBeenCalledTimes(2);
  mocks.authority.mockRejectedValue(hostedOnboardingError({ code: "CONSENT_REQUIRED", httpStatus: 403, message: "Consent required." }));
  const denied = progressSchema.parse(await (await progress(request(""))).json());
  expect(denied.medals).toEqual([]); expect(denied.shelf).toEqual([]); expect(denied.moments).toEqual([]);
});

it("keeps Steps only and never creates a missing Sleep sum", async () => {
  mocks.raw.mockResolvedValue({ ...raw(), numbers: { ...raw().numbers, sleep: null } });
  const result = healthSchema.parse(await (await health(request("/health"))).json());
  expect(result.sums.map(sum => sum.id)).toEqual(["steps"]);
});

it.each(["cold", "saved-route", "route-failure"])("measures the sequential Health/Progress refresh: %s", async scenario => {
  if (scenario === "saved-route") await saveState("steps", { legs: [leg] });
  if (scenario === "route-failure") mocks.resolve.mockRejectedValueOnce(new Error("synthetic unavailable route"));
  const started = performance.now();
  const response = await health(request("/health"));
  const healthMs = performance.now() - started;
  expect(response.status).toBe(scenario === "route-failure" ? 503 : 200);
  const result = await progress(request(""));
  expect(result.status).toBe(200);
  expect(mocks.raw).toHaveBeenCalledTimes(1);
  expect(mocks.resolve).toHaveBeenCalledTimes(scenario === "saved-route" ? 0 : 1);
  if (scenario === "route-failure") expect(awards).toEqual([]);
  console.info(JSON.stringify({ fixture: "health-refresh", scenario, healthMs: Math.round(healthMs * 100) / 100,
    totalMs: Math.round((performance.now() - started) * 100) / 100,
    replicaReads: mocks.raw.mock.calls.length, routeResolutions: mocks.resolve.mock.calls.length }));
});
