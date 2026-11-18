import { beforeEach, expect, it, vi } from "vitest";
import type { MeasureState } from "../src/lib/game/progress/state";
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), patch: vi.fn(), previous: {} as MeasureState }));
vi.mock("@/src/lib/game/progress/mapbox", () => ({ resolveRoute: mocks.resolve }));
vi.mock("@/src/lib/game/progress/state", () => ({ patchMeasureState: mocks.patch }));
import { healthJourneys, healthJourneyViews } from "../src/lib/game/progress/health-journeys";
import { healthAgeShare, healthSteps } from "../src/lib/game/progress/health";
import { friendPasses } from "../src/lib/game/progress/friends";
import { medalView } from "../src/lib/game/progress/view";
import { medalSchema, measureSchema } from "../src/lib/game/progress/contract";
import { encodePolyline } from "../src/lib/game/progress/route-geometry";
import * as routes from "../src/lib/game/progress/routes";
import { ladder } from "../src/lib/game/progress/bank";
import { projection } from "../src/lib/game/progress/goals";
import type { HealthMetricInput } from "../src/lib/game/progress/health-view";
import type { Candidate } from "../src/lib/game/progress/registry";
import { addDaysToIsoDate } from "@murphai/contracts";

const joinedOn = "2026-10-21", today = "2026-11-16";
const before = vi.fn();
const leg = { from: "A", to: "B", distanceM: 16093.44, polyline: encodePolyline([[0, 0], [1, 0]]),
  towns: [{ name: "B", atM: 16093.44 }], straightLine: false, startTotal: 0 };
const metric = (id: "steps" | "sleep", value: number): HealthMetricInput => ({ id, baseline: null, step: 1, direction: 1, wins: [],
  daily: Array.from({ length: 27 }, (_, i) => ({ date: addDaysToIsoDate(joinedOn, i), value, source: "Garmin", observedAt: `${today}T12:00:00Z` })) });
const saved = (candidates: Candidate[]) => candidates.map(candidate => ({ ...candidate, id: candidate.key, createdAt: new Date(`${today}T12:00:00Z`), seenAt: null }));
const prepare = (metrics: HealthMetricInput[], states = new Map<string, MeasureState>(), awards: ReturnType<typeof saved> = []) => healthJourneys({ memberId: "ava", metrics, states, awards,
  joinedOn, today, timeZone: "America/New_York", beforeMutationTx: before });
beforeEach(() => {
  vi.resetAllMocks(); mocks.previous = {};
  mocks.resolve.mockImplementation(async (from, to) => ({ ...leg, from, to }));
  mocks.patch.mockImplementation(async (_member, _id, patch, check) => {
    await check({ transaction: true });
    return { ...mocks.previous, ...(typeof patch === "function" ? patch(mocks.previous) : patch) };
  });
});

it("uses Sleep's curated time ladder, dates every crossing, and preserves passed journeys after a correction", async () => {
  const journeys = await prepare([metric("sleep", 8 * 3600)]);
  const awards = saved(journeys.candidates);
  const timeAwards = awards.filter(award => award.kind === "time");
  // Hours slept is no medal: Sleep earns only its journeys.
  expect(awards.filter(award => award.kind === "total")).toEqual([]);
  expect(timeAwards.map(award => medalView(award, false, "us").title)).toEqual(ladder("time", "sleep").filter(entry => entry.at <= 27 * 8 * 3600).map(entry => entry.name));
  expect(timeAwards[0].on).toBe(joinedOn);
  const view = measureSchema.parse(healthJourneyViews(journeys, awards, today, "us")[0]);
  expect(view).toMatchObject({ id: "sleep", source: "wearable", total: { value: 777600, text: "9 days", unit: "seconds" }, ladder: { kind: "time" }, route: null });
  expect(view.projection).toEqual(projection(journeys.measures[0], today, "us"));
  expect(view.projection).toHaveProperty("on", null);
  const corrected = await prepare([{ ...metric("sleep", 1), daily: [] }], new Map(), awards);
  expect(healthJourneyViews(corrected, awards, today, "us")[0].ladder?.passed).toEqual(view.ladder?.passed);
  expect(mocks.resolve).not.toHaveBeenCalled();
});

it("composes settled Steps into an about-miles route without mixing measured walk distance", async () => {
  const journeys = await prepare([metric("steps", 1000)]);
  expect(mocks.resolve).toHaveBeenCalledTimes(1);
  expect(before).toHaveBeenCalledWith({ transaction: true });
  const routeAward = journeys.candidates.find(award => award.kind === "route")!;
  expect(routeAward.on).toBe("2026-11-09");
  const renderRoute = vi.spyOn(routes, "routeView");
  const view = measureSchema.parse(healthJourneyViews(journeys, saved(journeys.candidates), today, "us")[0]);
  expect(renderRoute).toHaveBeenCalledOnce();
  renderRoute.mockRestore();
  expect(view.total).toEqual({ value: 27000, text: "27,000", unit: "steps" });
  expect(view.route).toMatchObject({ walkedText: "about 10 mi", progress: 1, goalPicked: false, finishedOn: "2026-11-09" });
  expect(view.route?.map).toContain("measure=steps");
  expect(view.ladder).toBeNull();
});

it("a route selected during the first resolution wins over the default", async () => {
  mocks.previous = { legs: [{ ...leg, from: "C", to: "D" }], goal: { route: { from: "C", to: "D" } } };
  const journeys = await prepare([metric("steps", 10)]);
  expect(healthJourneyViews(journeys, [], today, "us")[0].route).toMatchObject({ name: "C to D", goalPicked: true });
});

it("reuses frozen geometry without another provider call", async () => {
  await prepare([metric("steps", 100)], new Map([["steps", { legs: [leg] }]]));
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(mocks.patch).not.toHaveBeenCalled();
});

it("new health, friend and route awards decode through the shared medal view", async () => {
  const context = { metric: "restingHeartRate" as const, joinedOn, baseline: 100, step: 1, direction: -1,
    profile: { age: 35, sex: "female" as const }, means: metric("steps", 60).daily };
  const health = [...healthSteps(context), ...healthAgeShare(context)];
  const friends = friendPasses({ measureId: "pushups.reps", people: [
    { memberId: "ava", firstName: "Ava", avatarUrl: null, me: true, joinedOn, daily: [{ date: today, amount: 100 }] },
    { memberId: "leo", firstName: "Leo", avatarUrl: null, me: false, joinedOn, daily: [
      { date: "2026-11-10", amount: 20 }, { date: "2026-11-11", amount: 20 }, { date: "2026-11-12", amount: 10 }] },
  ] });
  const routes = (await prepare([metric("steps", 1000)])).candidates;
  for (const award of saved([...health, ...friends, ...routes])) expect(medalSchema.safeParse(medalView(award, false, "us")).success).toBe(true);
});
