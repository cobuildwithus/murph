import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as pressure } from "../app/api/game/v1/health/blood-pressure/route";
import { GET as food, POST as saveFood } from "../app/api/game/v1/health/food-week/route";
import { GET as combine } from "../app/api/game/v1/health/combine/route";
import { POST as session } from "../app/api/game/v1/health/combine/sessions/route";
import { POST as answer } from "../app/api/game/v1/health/you/answers/route";
import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({ load: vi.fn(), submit: vi.fn(), inputs: vi.fn(), authority: vi.fn() }));
vi.mock("../src/lib/game/http/auth", () => ({ requireGameMemberAuth: async () => ({ member: { id: "synthetic-only" } }) }));
vi.mock("../src/lib/device-sync/companion-numbers", () => ({ loadPublishedCompanionMetricReplica: mocks.load }));
vi.mock("../src/lib/health-you/inputs", () => ({ readYouInputs: mocks.inputs }));
vi.mock("../src/lib/device-sync/companion-member-actions", () => ({ submitCompanionMemberAction: mocks.submit }));
vi.mock("../src/lib/better-auth/rate-limit", () => ({ hostedAuthRateLimitStorage: () => ({ consume: async () => ({ allowed: true }) }) }));
vi.mock("../src/lib/prisma", () => ({ getPrisma: () => ({ $transaction: async (fn: (tx: object) => unknown) => fn({}) }) }));
vi.mock("../src/lib/better-auth/native-auth", () => ({ assertHostedNativeMemberAuthCurrentForRead: async () => {} }));
vi.mock("../src/lib/browser-vault/authority", () => ({ assertBrowserVaultMemberAuthority: mocks.authority }));
const id = "9a7c04e4-7f87-46d7-af2b-fbb09ab470a2";
const replica = { generation: 21, sleepTiming: [], meals: { timeZone: "America/Denver", days: [] }, entities: [],
  demographics: { status: "resolved", birthYear: 1992, biologicalSex: "male" } };
const ready = (data: object) => ({ state: "ready", client: { replica: data } });
const req = (data?: unknown) => new Request("https://fixture.test/api/game/v1/health/check-in", {
  method: data === undefined ? "GET" : "POST", body: JSON.stringify(data), headers: { "content-type": "application/json" },
});
const pair = { id, takenAt: "2023-09-19T20:10:00-06:00", systolic: 115, diastolic: 72 };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("MURPH_GAME_ENABLED", "true");
  vi.stubEnv("MURPH_HEALTH_FEED_MEMBER_IDS", "*");
  vi.stubEnv("MURPH_HEALTH_YOU_MEMBER_IDS", "synthetic-only");
  mocks.load.mockResolvedValue(ready(replica));
});
afterEach(() => vi.unstubAllEnvs());

describe("private check-in routes", () => {
  it.each([food, saveFood, pressure, combine, session, answer])("gates before loading or parsing", async route => {
    vi.stubEnv("MURPH_HEALTH_YOU_MEMBER_IDS", "");
    const res = await route(req({}));
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("requires the feed as well as the You allowlist", async () => {
    vi.stubEnv("MURPH_HEALTH_FEED_MEMBER_IDS", "");
    expect((await food(req())).status).toBe(404);
  });
  it("returns accepted and submits both pressures with the observed instant and member-local day", async () => {
    const res = await pressure(req(pair));
    expect(await res.json()).toMatchObject({ state: "accepted" });
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ request: expect.objectContaining({
      actionId: id, action: { kind: "measurement.blood-pressure", version: 1, systolic: 115, diastolic: 72,
        takenAt: "2023-09-20T02:10:00.000Z", date: "2023-09-19" },
    }) }));
  });
  it("blocks old projections and consent withdrawal during the load", async () => {
    mocks.load.mockResolvedValueOnce(ready({ ...replica, generation: 20 }));
    expect((await pressure(req(pair))).status).toBe(503);
    mocks.authority.mockResolvedValueOnce(undefined).mockRejectedValueOnce(hostedOnboardingError({
      code: "CONSENT_REQUIRED", httpStatus: 403, message: "Consent is required.", retryable: false,
    }));
    expect((await pressure(req(pair))).status).toBe(403);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("stops before replica access or submission even with no station values", async () => {
    const res = await session(req({ safety: { answer: "stop" } }));
    expect(res.status).toBe(409);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("previews the submitted session and reads the same result after publication", async () => {
    const date = "2023-09-19", tests = [{ key: "grip_strength", value: 55 }, { key: "pullups_max", value: 4 }];
    const res = await session(req({ id, date, tests, safety: { answer: "clear" } }));
    expect(res.status).toBe(200);
    const { saveState, countsBy, ...preview } = await res.json();
    expect(saveState).toBe("accepted");
    expect(countsBy).toBe("Counts in your age soon");
    expect(preview).toMatchObject({ id, date, retestOn: "2023-10-31", rank: { percentile: expect.any(Number) } });
    const response = mocks.submit.mock.calls[0]![0].request.action.response;
    mocks.load.mockResolvedValueOnce(ready({ ...replica, entities: [{ family: "assessment", attributes: { checkIn: { id, date, response } } }] }));
    expect(await (await combine(req())).json()).toMatchObject({ latest: preview, nextAt: preview.retestOn });
  });
  it("includes the model effect on acceptance and on readback from the published session", async () => {
    const date = new Intl.DateTimeFormat("sv-SE", { timeZone: replica.meals.timeZone }).format(new Date());
    const tests = [{ key: "sitting_rising", value: 3.5 }];
    const core = { ...replica, source: { dataVersion: "fixture-version" } };
    mocks.load.mockResolvedValue(ready(core));
    mocks.inputs.mockResolvedValue({ asOf: date, sourceRevision: core.source.dataVersion,
      evidence: { profile: { age: 62, sex: "female" }, labs: [{ marker: "rdw", value: 13, unit: "%", date }] } });
    const preview = await (await session(req({ id, date, tests, safety: { answer: "clear" } }))).json();
    expect(preview.years).toBeGreaterThan(0);
    const response = mocks.submit.mock.calls[0][0].request.action.response;
    mocks.load.mockResolvedValue(ready({ ...core, entities: [{ family: "assessment", attributes: { checkIn: { id, date, response } } }] }));
    expect(await (await combine(req())).json()).toMatchObject({ latest: { id, years: preview.years } });
    mocks.inputs.mockRejectedValue(new Error("Fixture projection unavailable"));
    expect((await (await combine(req())).json()).latest).not.toHaveProperty("years");
  });
  it.each([
    ["smoking", "former"], ["quitDate", "2020-02-29"], ["alcoholDrinksPerWeek", 3.5],
    ["diabetes", "unsure"], ["seriousDisease", "no"], ["selfRatedHealth", "veryGood"],
  ])("submits the typed %s answer to the canonical assessment", async (key, value) => {
    expect((await answer(req({ id, key, value }))).status).toBe(200);
    expect(mocks.submit.mock.calls[0][0].request.action.response).toEqual({
      instrument: "you-answer", instrumentVersion: 1, answer: { key, value },
    });
  });
  it.each([["diabetes", true], ["selfRatedHealth", "unsure"], ["quitDate", "2100-05-01"],
    ["quitDate", "2026-02-30"], ["alcoholDrinksPerWeek", -1], ["smoking", "yes"]])(
    "rejects an invalid %s answer before submission", async (key, value) => {
      expect((await answer(req({ id, key, value }))).status).toBe(400);
      expect(mocks.submit).not.toHaveBeenCalled();
    });
  it("accepts the food recall and a supported one-off answer, rejects unknown keys and an incomplete pair", async () => {
    const view = await (await food(req())).json();
    expect(view).toMatchObject({ state: "ready", daysLogged: 0 });
    expect(view.questions).toHaveLength(14);
    expect(view.questions.every((q: { label: string }) => q.label.split(" ").length <= 4)).toBe(true);
    const stations = await (await combine(req())).json();
    expect(stations.minutes).toBeGreaterThan(0);
    expect(new Set(stations.tests.map((t: { group: string }) => t.group))).toEqual(new Set(["strength", "movement"]));
    const answers = view.questions.map(({ key }: { key: string }) => ({ key, value: 1 }));
    expect(await (await saveFood(req({ id, answers }))).json()).toMatchObject({ state: "accepted" });
    expect(await (await answer(req({ id, key: "whoopZones", value: "notSure" }))).json()).toMatchObject({ state: "accepted" });
    expect((await answer(req({ id, key: "unsupported", value: "yes" }))).status).toBe(400);
    expect((await pressure(req({ id, systolic: 115, takenAt: pair.takenAt }))).status).toBe(400);
    expect((await saveFood(req({ id, answers: [...answers, answers[0]] }))).status).toBe(400);
    expect(mocks.submit).toHaveBeenCalledTimes(2);
  });
});
