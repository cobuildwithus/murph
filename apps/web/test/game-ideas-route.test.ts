import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";
import { checked, delayedProvider, INPUT, TASKS, written } from "./game-ideas-fixtures";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), consume: vi.fn() }));
vi.mock("@/src/lib/game/http/auth", () => ({ requireGameMember: mocks.auth }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({}) }));
vi.mock("@/src/lib/better-auth/rate-limit", () => ({ hostedAuthRateLimitStorage: () => ({ consume: mocks.consume }) }));
vi.mock("@/src/lib/game/ideas/service", async importOriginal => {
  const service = await importOriginal<typeof import("../src/lib/game/ideas/service")>();
  return { suggestGameIdeas: vi.fn(service.suggestGameIdeas) };
});
import { suggestGameIdeas } from "../src/lib/game/ideas/service";
import { POST } from "../app/api/game/v1/ideas/route";

const request = (body: unknown = INPUT) => new Request("https://example.test/api/game/v1/ideas", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("HOSTED_GAME_IDEAS", "on");
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  mocks.auth.mockResolvedValue("member-self");
  mocks.consume.mockResolvedValue({ allowed: true, retryAfter: null });
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValueOnce(written()).mockResolvedValueOnce(checked()));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("POST game ideas", () => {
  it("authenticates, validates and consumes the shared member budget before provider work", async () => {
    const result = await POST(request());
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await result.json()).toEqual({ ok: true, ideas: TASKS });
    expect(mocks.consume).toHaveBeenCalledWith("game-ideas:member:member-self", { max: 30, window: 600 });
    expect(mocks.auth.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(suggestGameIdeas).mock.invocationCallOrder[0]);
    expect(mocks.consume.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(fetch).mock.invocationCallOrder[0]);
  });
  it.each([[401, "UNAUTHENTICATED"], [404, "GAME_DISABLED"]])("preserves auth status %s", async (httpStatus, code) => {
    mocks.auth.mockRejectedValueOnce(hostedOnboardingError({ code, httpStatus, message: "Unavailable." }));
    const result = await POST(request());
    expect(result.status).toBe(httpStatus);
    expect(await result.json()).toMatchObject({ error: { code } });
    expect(suggestGameIdeas).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    ["step", undefined], ["step", "wrong"], ["category", "wrong"], ["category", null],
    ["relationship", undefined], ["relationship", "private label"], ["apart", undefined], ["apart", "false"],
    ["words", undefined], ["words", 1], ["words", "  "], ["words", "a".repeat(121)],
    ["task", 1], ["task", ""], ["task", "a".repeat(121)],
    ["directions", "outside"], ["directions", Array(7).fill("Outside")], ["directions", [1]],
    ["directions", ["a".repeat(31)]], ["directions", [""]],
    ["notForMe", ["water"]], ["notForMe", [1]], ["notForMe", null], ["notForMe", "yoga"],
    ["skipped", "walk"], ["skipped", Array(25).fill("Walk")], ["skipped", [1]],
    ["skipped", ["a".repeat(41)]], ["skipped", [""]],
  ])("rejects invalid %s before limiting or generating", async (field, value) => {
    const result = await POST(request({ ...INPUT, [String(field)]: value }));
    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(suggestGameIdeas).not.toHaveBeenCalled();
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("accepts and normalizes Not for me", async () => {
    vi.stubEnv("HOSTED_GAME_IDEAS", "off");
    expect((await POST(request({ ...INPUT, notForMe: ["dance", "swimming", "dance", "yoga"] }))).status).toBe(200);
    expect(suggestGameIdeas).toHaveBeenCalledWith("member-self", { ...INPUT, notForMe: ["swimming", "yoga", "dance"] });
  });
  it("accepts trimmed bounds and optional fields while dropping private fields", async () => {
    const result = await POST(request({ step: "prize", relationship: "partner", apart: true, words: ` ${"a".repeat(120)} `,
      task: "Walk 30 min", memberId: "someone-else", relationshipLabel: "private-label" }));
    expect(result.status).toBe(200);
    expect(suggestGameIdeas).toHaveBeenCalledWith("member-self", { step: "prize", relationship: "partner", apart: true,
      words: "a".repeat(120), task: "Walk 30 min", directions: [], skipped: [] });
  });
  it.each(["{", "[]", "null", JSON.stringify({ ...INPUT, words: "a".repeat(16384) })])("bounds and rejects malformed JSON", async body => {
    const result = await POST(new Request("https://example.test/api/game/v1/ideas", { method: "POST", body }));
    expect([400, 413]).toContain(result.status);
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not quote malformed private request text in errors or logs", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await POST(new Request("https://example.test/api/game/v1/ideas", { method: "POST", body: "private-input-is-not-json" }));
      expect(result.status).toBe(400);
      const payload = await result.json();
      expect(payload).toMatchObject({ error: { code: "INVALID_REQUEST" } });
      expect(JSON.stringify([payload, warning.mock.calls])).not.toContain("private-input-is-not-json");
    } finally {
      warning.mockRestore();
    }
  });
  it("skips all provider work when off, retaining authentication and validation", async () => {
    vi.stubEnv("HOSTED_GAME_IDEAS", "off");
    expect(await (await POST(request())).json()).toEqual({ ok: true, ideas: [] });
    expect((await POST(request({ ...INPUT, words: "" }))).status).toBe(400);
    expect(mocks.auth).toHaveBeenCalledTimes(2);
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("defaults on without a new required setting and fails soft when the key is absent", async () => {
    vi.stubEnv("HOSTED_GAME_IDEAS", undefined);
    expect((await POST(request())).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.stubEnv("OPENAI_API_KEY", undefined);
    expect(await (await POST(request())).json()).toEqual({ ok: true, ideas: [] });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each(["task", "prize", "dare"])("preserves rate limit errors and makes zero calls for %s", async step => {
    mocks.consume.mockResolvedValueOnce({ allowed: false, retryAfter: 30 });
    const result = await POST(request({ ...INPUT, step }));
    expect(result.status).toBe(429);
    expect(await result.json()).toMatchObject({ error: { code: "AUTH_RATE_LIMITED", retryable: true } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["provider", "malformed-write", "malformed-check"])("fails soft on %s", async failure => {
    const fetchStub = vi.fn<typeof fetch>();
    if (failure === "provider") fetchStub.mockResolvedValue(Response.json({ error: { message: "busy" } }, { status: 500 }));
    else if (failure === "malformed-write") fetchStub.mockResolvedValue(written("wrong"));
    else fetchStub.mockResolvedValueOnce(written()).mockResolvedValueOnce(Response.json({ answers: [] }));
    vi.stubGlobal("fetch", fetchStub);
    const result = await POST(request());
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true, ideas: [] });
    expect(fetchStub).toHaveBeenCalledTimes(failure === "malformed-check" ? 2 : 1);
  });
  it.each([[8001], [2500, 5501], [2500, 2500, 3001], [2000, 2000, 2000, 2001]])("fails soft at one total deadline: %j", async (...delays: number[]) => {
    vi.useFakeTimers();
    const fetchStub = delayedProvider(delays);
    vi.stubGlobal("fetch", fetchStub);
    const pending = POST(request());
    await vi.advanceTimersByTimeAsync(8000);
    const result = await pending;
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true, ideas: [] });
    expect(fetchStub).toHaveBeenCalledTimes(delays.length);
  });
});
