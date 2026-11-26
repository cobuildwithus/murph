import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GAME_IDEAS_MODEL } from "../game/ideas/writer";
import { decideHealthActivityKind } from "./activity-kind";
import type { RecordedActivityKind } from "./engine/types";

const { post, consume, findUnique, createMany } = vi.hoisted(() => ({
  post: vi.fn(), consume: vi.fn(), findUnique: vi.fn(), createMany: vi.fn(),
}));
vi.mock("openai", () => ({ default: class { post = post; } }));
vi.mock("../prisma", () => ({ getPrisma: () => ({ healthActivityKindDecision: { findUnique, createMany } }) }));
vi.mock("../better-auth/rate-limit", () => ({ hostedAuthRateLimitStorage: () => ({ consume }) }));

const kinds = ["run", "walk", "sauna", "cold_plunge", "lift", "other"] as const;
const answers = (kind: RecordedActivityKind, route: number, timer: number) => [
  { type: "predicate", name: "route", probability: route },
  { type: "choice", name: "kind", choice: kind, confidence: 0.9,
    probabilities: kinds.map(value => ({ value, probability: value === kind ? 0.9 : 0.02 })) },
  { type: "predicate", name: "timer", probability: timer },
] as const;
const memberId = "fixture-recorder";
const decide = (name: string, routeEnabled = true) => decideHealthActivityKind({
  name, routeEnabled, memberId, signal: new AbortController().signal,
});
const fallback = (name: string) => ({ name, kind: "other", timer: false, decided: false });

beforeEach(() => {
  vi.stubEnv("MURPH_HEALTH_ACTIVITY_DECISIONS", "true");
  vi.stubEnv("OPENAI_API_KEY", "fixture-api-key");
  vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", "v2");
  vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", "v2:" + Buffer.alloc(32, 57).toString("base64"));
  const rows = new Map<string, { kind: RecordedActivityKind; route: boolean; timer: boolean }>();
  findUnique.mockImplementation(async ({ where }) => rows.get(where.key) ?? null);
  createMany.mockImplementation(async ({ data }) => {
    if (!rows.has(data.key)) rows.set(data.key, data);
  });
  consume.mockResolvedValue({ allowed: true, retryAfter: 0 });
});
afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("sends only the admitted name in three question instructions", async () => {
  const name = "Forest hike";
  post.mockResolvedValue({ model: GAME_IDEAS_MODEL, usage: {}, answers: answers("walk", 0.6, 0.2) });
  await decide(name);
  expect(consume).toHaveBeenCalledExactlyOnceWith(`health-activity-kind:member:${memberId}`, { max: 30, window: 86_400 });
  expect(post).toHaveBeenCalledExactlyOnceWith("/decisions", {
    maxRetries: 0, timeout: 3_000, signal: expect.any(AbortSignal),
    body: {
      model: GAME_IDEAS_MODEL, input: expect.not.stringContaining(name),
      questions: [
        { type: "choice", name: "kind", instructions: expect.stringContaining(name),
          choices: kinds.map(value => ({ value, description: expect.stringMatching(/\S/u) })) },
        { type: "predicate", name: "route", instructions: expect.stringContaining(name) },
        { type: "predicate", name: "timer", instructions: expect.stringContaining(name) },
      ],
    },
  });
  const body = JSON.stringify(post.mock.calls[0][1].body);
  expect(body.split(name)).toHaveLength(4);
  expect(body).not.toContain(memberId);
});

it.each([
  ["Forest hike", "walk", 0.5, 0.49, true, "walk", false],
  ["Cycling", "run", 0.49, 0.1, true, "other", false],
  ["Steam room", "sauna", 0, 0, false, "sauna", true],
  ["Cool dip", "cold_plunge", 0, 0, false, "cold_plunge", true],
  ["Plank", "other", 0, 0.5, false, "other", true],
  ["Trail jog", "run", 1, 0, false, "other", false],
  ["Powerlifting", "lift", 0, 0, true, "lift", false],
] as const)("maps the most likely recorder and thresholds for %s", async (name, closest, route, timer, enabled, kind, useTimer) => {
  post.mockResolvedValue({ answers: answers(closest, route, timer) });
  expect(await decide(name, enabled)).toEqual({ name, kind, timer: useTimer, decided: true });
});

it("reuses a normalized opaque key across members, applying current route access on each hit", async () => {
  post.mockResolvedValue({ answers: answers("walk", 1, 0) });
  const name = "Ｆorest hike";
  expect(await decide(name, false)).toEqual({ name, kind: "other", timer: false, decided: true });
  const [{ data, skipDuplicates }] = createMany.mock.calls[0];
  expect(skipDuplicates).toBe(true);
  expect(data).toEqual({ key: expect.stringMatching(/^name:v1:v2:[A-Za-z0-9_-]{43}$/u), kind: "walk", route: true, timer: false });
  expect(JSON.stringify(data)).not.toMatch(/hike|recorder/iu);
  expect(await decideHealthActivityKind({ name: "FOREST HIKE", memberId: "fixture-partner", routeEnabled: true,
    signal: new AbortController().signal })).toEqual({ name: "FOREST HIKE", kind: "walk", timer: false, decided: true });
  expect(post).toHaveBeenCalledTimes(1);
  expect(consume).toHaveBeenCalledTimes(1);
  expect(createMany).toHaveBeenCalledTimes(1);
});

it("uses the winning stored answer when another request inserts first", async () => {
  findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ kind: "sauna", route: false, timer: false });
  createMany.mockResolvedValueOnce({ count: 0 });
  post.mockResolvedValue({ answers: answers("other", 0, 0) });
  expect(await decide("Heat session")).toEqual({ name: "Heat session", kind: "sauna", timer: true, decided: true });
  expect(createMany).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: "other" }), skipDuplicates: true });
});

const [route, choice, timer] = answers("walk", 0.8, 0);
it.each([
  ["absent answers", {}],
  ["missing timer", { answers: [choice, route] }],
  ["duplicate predicate", { answers: [choice, route, route] }],
  ["extra answer", { answers: [choice, route, timer, choice] }],
  ["refusal", { answers: [choice, route, { name: "timer", type: "refusal" }] }],
  ["out-of-range probability", { answers: [choice, route, { ...timer, probability: 2 }] }],
  ["missing kind", { answers: [{ ...choice, probabilities: choice.probabilities.slice(1) }, route, timer] }],
  ["duplicate kind", { answers: [{ ...choice, probabilities: kinds.map(() => ({ value: "walk", probability: 0.1 })) }, route, timer] }],
  ["unknown kind", { answers: [{ ...choice, probabilities: [
    ...choice.probabilities.slice(1), { value: "cycle", probability: 0.8 },
  ] }, route, timer] }],
])("returns an uncached fallback on %s", async (_case, payload) => {
  post.mockResolvedValueOnce(payload).mockResolvedValueOnce({ answers: answers("walk", 1, 0) });
  expect(await decide("Trail loop")).toEqual(fallback("Trail loop"));
  expect(createMany).not.toHaveBeenCalled();
  expect(await decide("Trail loop")).toMatchObject({ kind: "walk", decided: true });
});

it.each(["request", "deadline"])("honors the %s abort signal before caching", async source => {
  const request = new AbortController();
  const deadline = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  post.mockImplementation(async () => {
    (source === "request" ? request : deadline).abort();
    return { answers: answers("run", 1, 1) };
  });
  const name = "Track intervals";
  expect(await decideHealthActivityKind({ name, memberId, routeEnabled: true, signal: request.signal })).toEqual(fallback(name));
  expect(post.mock.calls[0][1].signal.aborted).toBe(true);
  expect(timeout).toHaveBeenCalledWith(3_000);
  expect(createMany).not.toHaveBeenCalled();
});

it("falls back when the provider fails", async () => {
  post.mockRejectedValue(new Error("fixture service failure"));
  expect(await decide("Stretch")).toEqual(fallback("Stretch"));
  expect(createMany).not.toHaveBeenCalled();
});

it.each([["false", "fixture-key"], ["true", ""]])("skips lookup, budget and provider when disabled or unconfigured", async (flag, key) => {
  vi.stubEnv("MURPH_HEALTH_ACTIVITY_DECISIONS", flag);
  vi.stubEnv("OPENAI_API_KEY", key);
  expect(await decide("Spin")).toEqual(fallback("Spin"));
  expect(findUnique).not.toHaveBeenCalled();
  expect(consume).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
});

it("skips the provider and storage write when the daily budget is used up", async () => {
  consume.mockResolvedValue({ allowed: false, retryAfter: 50 });
  expect(await decide("Rowing")).toEqual(fallback("Rowing"));
  expect(post).not.toHaveBeenCalled();
  expect(createMany).not.toHaveBeenCalled();
});
