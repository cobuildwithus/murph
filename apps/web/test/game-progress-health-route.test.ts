import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  raw: vi.fn(), current: vi.fn(), authority: vi.fn(), patch: vi.fn(), settle: vi.fn(), awards: vi.fn(),
  resolve: vi.fn(), profile: vi.fn(), measures: vi.fn(), open: vi.fn(), art: vi.fn(),
}));
vi.mock("@/src/lib/game/http/auth", () => ({ requireGameMemberAuth: async () => ({ member: { id: "ava" } }),
  assertGameMemberAuthCurrentTx: mocks.current }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({ gameProfile: { findUnique: mocks.profile },
  gameProgressMeasure: { findMany: mocks.measures } }) }));
vi.mock("@/src/lib/browser-vault/authority", () => ({ assertBrowserVaultMemberAuthority: mocks.authority }));
vi.mock("@/src/lib/device-sync/companion-numbers", async importOriginal => ({
  ...await importOriginal<typeof import("@/src/lib/device-sync/companion-numbers")>(),
  readCompanionHealthSeries: mocks.raw,
}));
vi.mock("@/src/lib/game/progress/crypto", () => ({ openProgressMany: mocks.open,
  progressLookup: (_member: string, _purpose: string, parts: string[]) => parts.join(":") }));
vi.mock("@/src/lib/game/progress/mapbox", () => ({ resolveRoute: mocks.resolve, previewRoute: async (from: string, to: string) => ({ leg: await mocks.resolve(from, to), query: { from, to }, fixed: null }), PlaceNotFound: class PlaceNotFound extends Error { constructor(readonly typed: string) { super(typed); } } }));
vi.mock("@/src/lib/game/progress/state", () => ({ patchMeasureState: mocks.patch }));
vi.mock("@/src/lib/game/progress/awards", () => ({ readAwards: mocks.awards, settleAwards: mocks.settle }));
vi.mock("@/src/lib/game/progress/route-art", () => ({ attachRouteArt: mocks.art }));


import { addDaysToIsoDate } from "@murphai/contracts";
import { getHostedDomainRootUnwrapCache } from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { GET } from "../app/api/game/v1/progress/health/route";
import { GET as goals } from "../app/api/game/v1/progress/goals/route";
import { PUT } from "../app/api/game/v1/progress/measures/[id]/route";
import { goalsSchema, healthSchema, savedHealthSchema } from "@/src/lib/game/progress/contract";
import { healthAgeShare, healthSteps } from "@/src/lib/game/progress/health";
import { encodePolyline } from "@/src/lib/game/progress/route-geometry";
import { routeLegs } from "@/src/lib/game/progress/route-progress";
import type { StoredAward } from "@/src/lib/game/progress/awards";
import notConnected from "./fixtures/progress/health-row08-not-connected.json";

const joinedOn = "2026-10-21", today = "2026-11-16";
const request = (query = "", units = "us") => new Request(`https://example.test/api/game/v1/progress/health${query}`,
  { headers: { "X-Murph-Client-Units": units } });
function snapshot() {
  const daily = Array.from({ length: 55 }, (_, index) => {
    const date = addDaysToIsoDate(joinedOn, index - 28);
    return { date, value: date < joinedOn ? 74 : 71, source: "Apple Watch", observedAt: `${date}T12:00:00Z` };
  });
  return { timeZone: "UTC", savedAt: `${today}T12:00:00Z`, freshness: "fresh",
    window: { from: "2025-11-17", through: today }, stepsWindow: { from: "2025-11-17", through: "2026-11-15" },
    demographics: { birthYear: 1991, biologicalSex: "female" },
    numbers: { restingHeartRate: { daily }, steps: null, sleep: null, vo2Max: null } };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${today}T12:00:00Z`));
  mocks.profile.mockResolvedValue({ createdAt: new Date(`${joinedOn}T12:00:00Z`), timeZone: "UTC" });
  mocks.measures.mockResolvedValue([]);
  mocks.open.mockResolvedValue([]);
  mocks.awards.mockResolvedValue([]);
  mocks.raw.mockResolvedValue(snapshot());
  mocks.patch.mockImplementation(async (_member, _measure, patch, before) => { await before({ transaction: true }); return typeof patch === "function" ? patch({}) : patch; });
  mocks.settle.mockImplementation(async (_member, _candidates, before) => { await before({ transaction: true }); });
});
afterEach(() => vi.useRealTimers());

it("reads Health inside the request's root unwrap cache", async () => {
  mocks.raw.mockImplementationOnce(async () => {
    expect(getHostedDomainRootUnwrapCache()).toBeDefined();
    return snapshot();
  });
  expect((await GET(request())).status).toBe(200);
  expect(mocks.raw.mock.calls.map(call => call[2])).toEqual([["restingHeartRate", "steps", "sleep"]]);
});

it("a vault read failure is one retryable 503 with empty saved presentation and no writes", async () => {
  mocks.raw.mockRejectedValueOnce(hostedOnboardingError({ code: "NUMBERS_PROJECTION_UNAVAILABLE", httpStatus: 503,
    retryable: true, message: "Numbers are temporarily unavailable." }));
  const response = await GET(request());
  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body).toMatchObject({ error: { code: "NUMBERS_PROJECTION_UNAVAILABLE", retryable: true } });
  const saved = savedHealthSchema.parse(body.error.details.health);
  expect(saved.winCount).toBe(0);
  expect(saved.metrics.every(metric => metric.headline === null && metric.next === null && metric.wins.length === 0)).toBe(true);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.raw).toHaveBeenCalledTimes(1);
  expect(mocks.measures).toHaveBeenCalledTimes(1);
  expect(mocks.patch).not.toHaveBeenCalled();
  expect(mocks.settle).not.toHaveBeenCalled();
  expect(mocks.awards).toHaveBeenCalledTimes(1);
});

it("keeps the normal saved win tiles, headline and next target when the live read fails", async () => {
  const context = { metric: "restingHeartRate" as const, joinedOn, baseline: 74, step: 1, direction: -1,
    profile: { age: 35, sex: "female" as const }, means: snapshot().numbers.restingHeartRate.daily
      .filter(point => point.date >= joinedOn).map(point => ({ ...point, value: 72 })) };
  const wins: StoredAward[] = [...healthSteps(context), ...healthAgeShare({ ...context, baseline: 100,
    means: context.means.map(point => ({ ...point, value: 20 })) })].map((award, index) => ({ ...award,
    id: `saved-${index}`, createdAt: new Date(`${today}T12:00:00Z`), seenAt: null }));
  mocks.measures.mockResolvedValue([{ lookup: "restingHeartRate", stateEncrypted: "synthetic-sealed" }]);
  mocks.open.mockResolvedValue([{ baseline: { value: 74, from: "2026-09-23", to: "2026-10-20" } }]);
  mocks.awards.mockResolvedValue(wins);
  const normal = healthSchema.parse(await (await GET(request())).json()).metrics[0];
  mocks.patch.mockClear(); mocks.settle.mockClear();
  mocks.raw.mockRejectedValueOnce(hostedOnboardingError({ code: "NUMBERS_PROJECTION_UNAVAILABLE", httpStatus: 503,
    retryable: true, message: "Numbers are temporarily unavailable." }));
  const logs = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await GET(request());
    expect(response.status).toBe(503);
    const body = await response.json();
    const saved = savedHealthSchema.parse(body.error.details.health);
    expect(saved).toMatchObject({ joinedOn, today, winCount: wins.length });
    expect(saved.metrics[0]).toMatchObject({ headline: "Down 2 bpm", wins: normal.wins, next: normal.next });
    expect(saved.metrics[0].wins.map(win => win.on)).toEqual(wins.map(win => win.on));
    expect(saved.metrics[0].wins.find(win => win.title === "Beat 1 in 3")).toMatchObject({ detail: "women your age" });
    expect(JSON.stringify(logs.mock.calls)).not.toMatch(/Down 2|women your age|synthetic-sealed|saved-0/);
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();
  } finally { logs.mockRestore(); }
});

it.each(["session", "health"])("withholds saved health after %s authority is lost during decryption", async boundary => {
  mocks.raw.mockRejectedValueOnce(hostedOnboardingError({ code: "NUMBERS_PROJECTION_UNAVAILABLE", httpStatus: 503,
    retryable: true, message: "Numbers are temporarily unavailable." }));
  const check = boundary === "session" ? mocks.current : mocks.authority;
  check.mockResolvedValueOnce(undefined).mockRejectedValueOnce(hostedOnboardingError({ code: "CONSENT_REQUIRED",
    httpStatus: 403, message: "Consent required." }));
  const response = await GET(request());
  expect(response.status).toBe(403);
  expect((await response.json()).error.details).toBeUndefined();
  expect(mocks.patch).not.toHaveBeenCalled();
  expect(mocks.settle).not.toHaveBeenCalled();
});

it("does not turn a live authority denial into a saved-data response", async () => {
  mocks.raw.mockRejectedValueOnce(hostedOnboardingError({ code: "CONSENT_REQUIRED", httpStatus: 403, message: "Consent required." }));
  expect((await GET(request())).status).toBe(403);
  expect(mocks.measures).not.toHaveBeenCalled();
  expect(mocks.awards).not.toHaveBeenCalled();
});

it("returns private uncached health with raw baseline and all crossed levels", async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(healthSchema.parse(await response.json())).toMatchObject({ joinedOn, today,
    metrics: [expect.objectContaining({ id: "restingHeartRate", baseline: { value: 74, text: "74", unit: "bpm" },
      next: { title: "Next win", detail: "73 bpm", face: { delta: { icon: "heart", text: "↓1" } } },
      age: expect.objectContaining({ typical: expect.objectContaining({ unit: "bpm", value: expect.any(Number) }) }) }),
      expect.any(Object), expect.any(Object)] });
  expect(mocks.patch).toHaveBeenCalledWith("ava", "restingHeartRate",
    { baseline: { value: 74, from: "2026-09-23", to: "2026-10-20" } }, expect.any(Function));
  const candidates = mocks.settle.mock.calls[0][1];
  expect(candidates.filter((award: { kind: string }) => award.kind === "health").map((award: { data: { level: number } }) => award.data.level))
    .toEqual([1, 2, 3]);
  expect(mocks.authority).toHaveBeenCalledWith({ memberId: "ava", prisma: { transaction: true } });
});

it("leaves VO2 max out of Progress Health", async () => {
  const raw = snapshot();
  mocks.raw.mockResolvedValue({ ...raw, numbers: { ...raw.numbers, vo2Max: { daily: raw.numbers.restingHeartRate.daily.map(point => ({ ...point, value: 40 })) } } });
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(healthSchema.parse(await response.json()).metrics.map(metric => metric.id)).toEqual(["restingHeartRate", "steps", "sleep"]);
  expect(mocks.patch).not.toHaveBeenCalledWith("ava", "vo2Max", expect.anything(), expect.any(Function));
});

it.each([100_000_074, Number.MAX_VALUE, -Number.MAX_VALUE])("ignores an extreme frozen baseline without rewriting it (%s)", async value => {
  const wins: StoredAward[] = healthSteps({ metric: "restingHeartRate", joinedOn, baseline: 74, step: 1, direction: -1,
    profile: { age: 35, sex: "female" }, means: snapshot().numbers.restingHeartRate.daily
      .filter(point => point.date >= joinedOn) }).map((award, index) => ({ ...award,
    id: `saved-${index}`, createdAt: new Date(`${today}T12:00:00Z`), seenAt: null }));
  mocks.measures.mockResolvedValue([{ lookup: "restingHeartRate", stateEncrypted: "synthetic-sealed" }]);
  mocks.open.mockResolvedValue([{ baseline: { value, from: "2026-09-23", to: "2026-10-20" } }]);
  mocks.awards.mockResolvedValue(wins);
  const response = await GET(request());
  expect(response.status).toBe(200);
  const metric = healthSchema.parse(await response.json()).metrics[0];
  expect(metric.baseline).toBeNull();
  expect(metric.wins.map(win => [win.medalId, win.on])).toEqual(wins.map(win => [win.id, win.on]));
  expect(mocks.patch).not.toHaveBeenCalled();
  expect(mocks.settle.mock.calls[0][1]).toEqual([]);
});

it.each(["restingHeartRate", "steps", "sleep"] as const)(
  "excludes overflow-scale %s values before baseline arithmetic", async id => {
    const daily = snapshot().numbers.restingHeartRate.daily.map(point => ({ ...point, value: Number.MAX_VALUE }));
    mocks.raw.mockResolvedValue({ ...snapshot(), numbers: { restingHeartRate: null, steps: null, sleep: null, vo2Max: null, [id]: { daily } } });
    const response = await GET(request());
    expect(response.status).toBe(200);
    const metric = healthSchema.parse(await response.json()).metrics.find(metric => metric.id === id)!;
    expect(metric.baseline).toBeNull();
    expect(metric.wins).toEqual([]);
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(mocks.settle.mock.calls[0][1]).toEqual([]);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

it.each([
  { id: "restingHeartRate", value: 250, baseline: 250 },
  { id: "steps", value: 1_000_000, baseline: 1_000_000 },
  { id: "sleep", value: 1440, baseline: 86400 },
] as const)("keeps the inclusive $id limit and excludes corrupt baseline dates", async ({ id, value, baseline }) => {
  const daily = snapshot().numbers.restingHeartRate.daily.slice(0, 28)
    .map((point, index) => ({ ...point, value: index < 20 ? value : value + 1 }));
  mocks.raw.mockResolvedValue({ ...snapshot(), numbers: { restingHeartRate: null, steps: null, sleep: null, vo2Max: null, [id]: { daily } } });
  const response = await GET(request());
  expect(response.status).toBe(200);
  const metric = healthSchema.parse(await response.json()).metrics.find(metric => metric.id === id)!;
  expect(metric.baseline?.value).toBe(baseline);
  expect(mocks.patch).toHaveBeenCalledWith("ava", id,
    { baseline: { value: baseline, from: "2026-09-23", to: "2026-10-20" } }, expect.any(Function));
  expect(mocks.settle.mock.calls[0][1]).toEqual([]);
});

it.each([["us", "1 mi"], ["metric", "1.6 km"]])("renders the Steps journey in requested %s units", async (units, walkedText) => {
  const raw = snapshot();
  mocks.raw.mockResolvedValue({ ...raw, numbers: { ...raw.numbers,
    steps: { daily: [{ date: joinedOn, value: 2000, source: "Garmin", observedAt: `${joinedOn}T12:00:00Z` }] } } });
  mocks.measures.mockResolvedValue([{ lookup: "steps", stateEncrypted: "synthetic-sealed" }]);
  mocks.open.mockResolvedValue([{ legs: [{ from: "A", to: "B", distanceM: 16093.44, startTotal: 0,
    polyline: encodePolyline([[0, 0], [1, 0]]), towns: [], straightLine: false }] }]);
  const body = healthSchema.parse(await (await GET(request("", units))).json());
  expect(body.sums.find(sum => sum.id === "steps")).toMatchObject({ total: { value: 2000, unit: "steps" }, route: { walkedText } });
  expect(mocks.resolve).not.toHaveBeenCalled();
});

const stepsUrl = "https://example.test/api/game/v1/progress";
const stepsGoals = (q?: string) => goals(new Request(`${stepsUrl}/goals?measure=steps${q ? `&q=${encodeURIComponent(q)}` : ""}`));
const pickSteps = (goal: object) => PUT(new Request(`${stepsUrl}/measures/steps`, {
  method: "PUT", body: JSON.stringify({ goal }),
}), { params: Promise.resolve({ id: "steps" }) });

function stepsSnapshot() {
  const daily = [addDaysToIsoDate(joinedOn, -1), joinedOn].map(date => ({
    date, value: 4000, source: "Garmin", observedAt: `${date}T12:00:00Z`,
  }));
  mocks.raw.mockResolvedValue({ ...snapshot(), numbers: { steps: { daily } } });
  const leg = { from: "A", to: "B", distanceM: 1609.344, startTotal: 0,
    towns: [], straightLine: false, polyline: encodePolyline([[0, 0], [1, 0]]) };
  mocks.resolve.mockImplementation(async (from, to) => ({ ...leg, from, to, name: "Around Iceland", distanceM: 1322000 }));
  return leg;
}

it("previews a suggested Steps loop and returns the same wearable measure as Health after rollover", async () => {
  const first = stepsSnapshot();
  const initial = goalsSchema.parse(await (await stepsGoals()).json());
  const loop = initial.suggestions.find(tile => tile.id === "around-iceland")!;
  expect(loop).toMatchObject({ name: "Around Iceland", atText: "821 mi" });
  mocks.measures.mockResolvedValue([{ lookup: "steps", stateEncrypted: "synthetic-sealed" }]);
  mocks.open.mockResolvedValue([{ legs: [first] }]);
  const preview = goalsSchema.parse(await (await stepsGoals(loop.name)).json()).route!;
  expect(preview).toMatchObject({ from: "Reykjavík, Iceland", to: "Reykjavík, Iceland",
    distanceText: "821 miles", detail: "By road. You're 0 in, so 821 to go." });
  const params = new URL(preview.map, stepsUrl).searchParams;
  expect(Object.fromEntries(params)).toEqual({ from: preview.from, to: preview.to, size: "card" });
  expect(mocks.awards).toHaveBeenCalledOnce();
  expect(mocks.patch).not.toHaveBeenCalled();
  mocks.patch.mockImplementationOnce(async (_member, _id, patch, before) => {
    await before({ transaction: true });
    const state = patch({ legs: [first] });
    mocks.measures.mockResolvedValue([{ lookup: "steps", stateEncrypted: "synthetic-sealed" }]);
    mocks.open.mockResolvedValue([state]);
    return state;
  });
  const response = await pickSteps({ from: preview.from, to: preview.to });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ ok: true, measure: { id: "steps", source: "wearable", total: { value: 4000, unit: "steps" },
    route: { name: loop.name, totalText: "2 mi", walkedText: "0 mi", progress: 0, goalPicked: true } } });
  // The new route's map and posters start with the pick, not on the next Health read.
  expect(mocks.art).toHaveBeenCalledExactlyOnceWith([expect.objectContaining({ id: "steps", route: expect.objectContaining({ name: loop.name }) })],
    new Map([["steps", expect.objectContaining({ legs: expect.arrayContaining([expect.objectContaining({ to: preview.to })]) })]]),
    { memberId: "ava", beforeMutationTx: expect.any(Function) });
  const health = healthSchema.parse(await (await GET(request())).json());
  expect(body.measure).toEqual(health.sums.find(sum => sum.id === "steps"));
  expect(mocks.resolve).toHaveBeenCalledTimes(2);
  expect(mocks.authority).toHaveBeenCalledWith({ memberId: "ava", prisma: { transaction: true } });
});

function finishedStepsRoute() {
  const first = stepsSnapshot();
  const completion = routeLegs({ measureId: "steps", legs: [first], points: [[joinedOn, 236_000]] })[0]!;
  const award = { ...completion, id: completion.key, createdAt: new Date(joinedOn), seenAt: null };
  mocks.awards.mockResolvedValue([award]);
  mocks.patch.mockImplementation(async (_member, _id, patch, before) => {
    await before({ transaction: true });
    return patch({ legs: [first] });
  });
  mocks.resolve.mockImplementation(async (from, to) => ({ ...first, from, to }));
  return { first, award };
}

it("waits for the Steps replica before previewing or rolling over a finished route", async () => {
  const { first, award } = finishedStepsRoute();
  const goal = { from: "B", to: "C" };
  mocks.raw.mockResolvedValue(null);
  for (const response of [await pickSteps(goal), await stepsGoals("B to C")]) {
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "PROGRESS_INCOMPLETE", retryable: true } });
  }
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(mocks.patch).not.toHaveBeenCalled();
  expect(mocks.settle).not.toHaveBeenCalled();

  const daily = Array.from({ length: 20 }, (_, i) => {
    const date = addDaysToIsoDate(joinedOn, i);
    return { date, value: 11_800, source: "Garmin", observedAt: `${date}T12:00:00Z` };
  });
  mocks.raw.mockResolvedValue({ ...snapshot(), numbers: { steps: { daily } } });
  const response = await pickSteps(goal);
  expect(response.status).toBe(200);
  expect(await mocks.patch.mock.results[0]!.value).toMatchObject({ legs: [first, { ...goal, startTotal: 189_902.592 }] });
  expect(await response.json()).toMatchObject({ measure: { total: { value: 236_000 }, route: { progress: 0, finishedOn: null } } });
  expect(mocks.settle.mock.calls[0]![1]).toEqual([expect.objectContaining({ key: award.key })]);
});

it("can set a Steps goal when a successful read has no retained steps", async () => {
  finishedStepsRoute();
  mocks.raw.mockResolvedValue(snapshot());
  const response = await pickSteps({ from: "B", to: "C" });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ measure: { total: { value: 0 }, route: { name: "B to C", goalPicked: true } } });
});

it.each(["session", "vault"])("withholds the Steps preview after %s authority is lost during resolution", async boundary => {
  stepsSnapshot();
  const check = boundary === "session" ? mocks.current : mocks.authority;
  check.mockRejectedValueOnce(hostedOnboardingError({ code: "CONSENT_REQUIRED", httpStatus: 403, message: "Consent required." }));
  const response = await stepsGoals("Around Iceland");
  expect(mocks.resolve).toHaveBeenCalledOnce();
  expect(response.status).toBe(403);
  expect(await response.json()).not.toHaveProperty("route");
});

it.each(["commit", "response"])("rechecks vault authority for a changed Steps route at %s", async boundary => {
  stepsSnapshot();
  const loss = hostedOnboardingError({ code: "CONSENT_REQUIRED", httpStatus: 403, message: "Consent required." });
  mocks.settle.mockResolvedValue(false);
  if (boundary === "response") mocks.authority.mockResolvedValueOnce(undefined);
  mocks.authority.mockRejectedValueOnce(loss);
  const response = await pickSteps({ rungId: "around-iceland" });
  expect(response.status).toBe(403);
  expect(await response.json()).not.toHaveProperty("measure");
  expect(mocks.settle).toHaveBeenCalledTimes(boundary === "commit" ? 0 : 1);
});

it("serves curated recommendation glyphs on a flat metric without model work", async () => {
  const raw = snapshot();
  raw.numbers.restingHeartRate.daily = raw.numbers.restingHeartRate.daily.map(point => ({ ...point, value: 74 }));
  mocks.raw.mockResolvedValue(raw);
  const body = healthSchema.parse(await (await GET(request())).json());
  expect(body.recs).toEqual([expect.objectContaining({ id: "cardio", category: "move", icon: "heart" })]);
});

it("authority lost at baseline commit prevents settlement", async () => {
  mocks.authority.mockRejectedValueOnce(hostedOnboardingError({ code: "CONSENT_REQUIRED", httpStatus: 403, message: "Consent required." }));
  expect((await GET(request())).status).toBe(403);
  expect(mocks.settle).not.toHaveBeenCalled();
  expect(mocks.awards).toHaveBeenCalledTimes(1);
});

it("a frozen baseline is reused and settlement still checks authority", async () => {
  mocks.measures.mockResolvedValue([{ lookup: "restingHeartRate", stateEncrypted: "synthetic-sealed" }]);
  mocks.open.mockResolvedValue([{ baseline: { value: 74, from: "2026-09-23", to: "2026-10-20" } }]);
  mocks.authority.mockRejectedValueOnce(hostedOnboardingError({ code: "CONSENT_REQUIRED", httpStatus: 403, message: "Consent required." }));
  expect((await GET(request())).status).toBe(403);
  expect(mocks.patch).not.toHaveBeenCalled();
  expect(mocks.settle).toHaveBeenCalledTimes(1);
  expect(mocks.awards).toHaveBeenCalledTimes(1);
});

it("validates the query before opening any health data", async () => {
  expect((await GET(request("?memberId=leo"))).status).toBe(400);
  expect(mocks.raw).not.toHaveBeenCalled();
});

it("an age-bracket change does not mint a health-age award", async () => {
  const saved = snapshot();
  mocks.raw.mockResolvedValue({ ...saved, demographics: { birthYear: 1987, biologicalSex: "female" },
    numbers: { restingHeartRate: null, steps: null, sleep: null,
      vo2Max: { daily: saved.numbers.restingHeartRate.daily.map(point => ({ ...point, value: point.date < joinedOn ? 24 : 26 })) } } });
  expect((await GET(request())).status).toBe(200);
  const first = mocks.settle.mock.calls[0][1];
  vi.setSystemTime(new Date("2027-01-01T12:00:00Z"));
  expect((await GET(request())).status).toBe(200);
  expect(mocks.settle.mock.calls[1][1]).toEqual(first);
  expect(first).not.toContainEqual(expect.objectContaining({ kind: "healthAge", data: expect.objectContaining({ percentile: 50 }) }));
});

it("matches BE0's not-connected health golden response", async () => {
  mocks.raw.mockResolvedValue(null);
  vi.setSystemTime(new Date(`${notConnected.today}T12:00:00Z`));
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(notConnected);
});

it("a default-route failure returns one retryable 503 before settling any health awards", async () => {
  const raw = snapshot();
  mocks.raw.mockResolvedValue({ ...raw, numbers: { restingHeartRate: null, sleep: null, vo2Max: null,
    steps: { daily: [{ date: joinedOn, value: 4000, source: "Garmin", observedAt: `${joinedOn}T12:00:00Z` }] } } });
  mocks.resolve.mockRejectedValueOnce(hostedOnboardingError({ code: "PROGRESS_MAP_UNAVAILABLE", httpStatus: 503, retryable: true,
    message: "The map could not load. Try again." }));
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: { retryable: true } });
  expect(mocks.resolve).toHaveBeenCalledTimes(1);
  expect(mocks.settle).not.toHaveBeenCalled();
});


it.each([
  ["2026-11-09", "off"],
  ["2026-11-08", "missing"],
] as const)("uses member-local seven-day boundaries for wearable evidence on %s", async (date, access) => {
  vi.setSystemTime(new Date("2026-11-16T01:00:00Z"));
  mocks.profile.mockResolvedValue({ createdAt: new Date(`${joinedOn}T12:00:00Z`), timeZone: "America/Los_Angeles" });
  const raw = snapshot();
  mocks.raw.mockResolvedValue({ ...raw, numbers: { ...raw.numbers, restingHeartRate: { daily: [
    { date, value: 70, source: "Apple Watch", observedAt: `${date}T12:00:00Z` },
  ] } } });
  const response = await GET(request());
  expect(response.status).toBe(200);
  const body = healthSchema.parse(await response.json());
  expect(body.today).toBe("2026-11-15");
  expect(body.metrics.find(metric => metric.id === "sleep")!.access).toBe(access);
  expect(body.metrics.find(metric => metric.id === "steps")!.access).toBe("missing");
});
