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
const ready = (data: object) => ({ state: "ready", freshness: "fresh", client: { replica: data } });
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
  it("records an unknown setting and canonicalizes equivalent instants across local midnight", async () => {
    for (const takenAt of ["2023-09-20T02:10:00Z", "2023-09-20T02:10:00+00:00", "2023-09-20T04:10:00+02:00"]) {
      const result = await (await pressure(req({ ...pair, takenAt }))).json();
      expect(result).toMatchObject({ state: "recorded", next: expect.any(String) });
      expect(result).not.toHaveProperty("countsBy");
    }
    expect(mocks.submit.mock.calls.map(call => call[0].request)).toEqual(Array(3).fill({
      actionId: id, schemaVersion: 1, requestedAt: "2023-09-20T02:10:00.000Z", action: {
        kind: "measurement.blood-pressure", version: 1, systolic: 115, diastolic: 72, takenAt: "2023-09-20T02:10:00.000Z",
      },
    }));
  });
  it.each(["home", "clinic"])("accepts the reading that completes a %s series", async setting => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2033-05-13T22:00:00Z"));
      const times = setting === "home" ? ["07:00", "07:03", "18:00", "18:03"] : ["11:30", "11:32"];
      const dates = setting === "home" ? ["2033-05-11", "2033-05-12", "2033-05-13"] : ["2033-05-12", "2033-05-13"];
      const rows: { metricKey: string; observedAt: string; date: string; value: number }[] = [];
      mocks.load.mockResolvedValue({ state: "ready", freshness: "fresh", client: {
        replica: { ...replica, meals: { timeZone: "UTC", days: [] } },
        metrics: { list: ({ metricKey }: { metricKey: string }) => rows.filter(r => r.metricKey === metricKey) },
      } });
      for (const date of dates) for (const time of times) {
        const takenAt = date + "T" + time + ":00Z";
        const reading = await (await pressure(req({ ...pair, id: crypto.randomUUID(), takenAt, setting }))).json();
        expect(reading.state).toBe(date === dates.at(-1) && time === times.at(-1) ? "accepted" : "recorded");
        const action = mocks.submit.mock.lastCall![0].request.action;
        expect(action.setting).toBe(setting);
        for (const component of ["systolic", "diastolic"]) rows.push({
          metricKey: component + "-blood-pressure", date, observedAt: action.takenAt, value: action[component],
          ...{ context: { qualifiers: { setting, validated: setting === "home" } }, recordIds: [takenAt], unit: "mmHg", statistic: "value", sourceKind: "measurement" },
        });
      }
    } finally { vi.useRealTimers(); }
  });
  it.each([food, combine])("requires fresh data for the current check-in screen", async route => {
    for (const result of [{ ...ready(replica), freshness: "stale" }, { state: "unpublished" }]) {
      mocks.load.mockResolvedValueOnce(result);
      expect((await route(req())).status).toBe(503);
    }
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
    expect((await session(req({ id, date, tests: [{ key: "pullups_max", skipped: true, value: 0 }], safety: { answer: "clear" } }))).status).toBe(400);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(await (await combine(req())).json()).toMatchObject({ latest: preview, nextAt: preview.retestOn });
  });
  it("includes the model effect on acceptance and on readback from the published session", async () => {
    const date = new Intl.DateTimeFormat("sv-SE", { timeZone: replica.meals.timeZone }).format(new Date());
    const tests = [{ key: "sitting_rising", value: 3.5 }, { key: "pullups_max", value: 0 },
      { key: "squats_max", value: 7 }, { key: "step_3min", skipped: true }];
    const core = { ...replica, source: { dataVersion: "fixture-version" } };
    mocks.load.mockResolvedValue(ready(core));
    mocks.inputs.mockResolvedValue({ asOf: date, sourceRevision: core.source.dataVersion,
      evidence: { profile: { age: 62, sex: "female" }, labs: [{ marker: "rdw", value: 13, unit: "%", date }] } });
    const preview = await (await session(req({ id, date, tests, safety: { answer: "clear" } }))).json();
    expect(preview).toMatchObject({ completed: 3, skipped: 1 });
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
  it("submits a closed habit answer with a replayable action ID after the publication upgrade", async () => {
    const fields = { id, key: "coffee_cups", value: "Three" };
    expect((await answer(req(fields))).status).toBe(503);
    mocks.load.mockResolvedValue(ready({ ...replica, generation: 22 }));
    expect((await answer(req({ ...fields, value: "unlisted" }))).status).toBe(400);
    expect(mocks.submit).not.toHaveBeenCalled();
    for (let replay = 0; replay < 2; replay++) expect((await answer(req(fields))).status).toBe(200);
    const requests = mocks.submit.mock.calls.map(([call]) => call.request);
    expect(requests[1].actionId).toEqual(requests[0].actionId);
    expect(requests[1].action).toEqual(requests[0].action);
    expect(requests[0]).toMatchObject({ actionId: id, action: { kind: "assessment.respond",
      response: { instrument: "you-answer", instrumentVersion: 1, answer: { key: fields.key, value: fields.value } } } });
  });
  it.each([["diabetes", true], ["selfRatedHealth", "unsure"], ["quitDate", "2100-05-01"],
    ["quitDate", "2026-02-30"], ["alcoholDrinksPerWeek", -1], ["smoking", "yes"]])(
    "rejects an invalid %s answer before submission", async (key, value) => {
      expect((await answer(req({ id, key, value }))).status).toBe(400);
      expect(mocks.submit).not.toHaveBeenCalled();
    });
  it.each([
    ["fried_days", "eating_days", "Days with fried foods"],
    ["packaged_days", "eating_days", "Days with salty snacks"],
    ["max_occasion", "alcohol", "Drinks in one sitting"],
  ])("publishes and enforces the %s limit", async (key, parent, message) => {
    const { questions } = await (await food(req())).json();
    expect(questions).toContainEqual(expect.objectContaining({ key, maxFrom: parent }));
    for (const question of questions) expect(question).toMatchObject({ min: 0, max: expect.any(Number) });
    const answers = questions.map((q: { key: string }) => ({ key: q.key, value: q.key === key ? 2 : 1 }));
    const rejected = await saveFood(req({ id, answers }));
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ error: { message: expect.stringContaining(message) } });
    expect(mocks.submit).not.toHaveBeenCalled();
    const valid = answers.map((a: { key: string; value: number }) => a.key === parent ? { ...a, value: 2 } : a);
    expect((await saveFood(req({ id, answers: valid }))).status).toBe(200);
  });
  it("accepts the food recall and a supported one-off answer, rejects unknown keys and an incomplete pair", async () => {
    const view = await (await food(req())).json();
    expect(view).toMatchObject({ state: "ready", daysLogged: 0 });
    expect(view.questions).toHaveLength(15);
    expect(view.questions.filter((q: { kind: string }) => q.kind === "drinks").map((q: { key: string }) => q.key)).toEqual(["alcohol", "max_occasion"]);
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
