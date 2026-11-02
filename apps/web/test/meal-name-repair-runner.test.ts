import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ native: { fetch: vi.fn(), dispose: vi.fn() } }));
vi.mock("@playwright/test", () => ({ chromium: {}, request: { newContext: vi.fn(async () => mocks.native) } }));
vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn(async () => {}) }));
import { runAll, runOwner } from "../scripts/ops-meal-name-repair";

function response(body: unknown) {
  return { ok: () => true, body: async () => Buffer.from(JSON.stringify(body)), dispose: vi.fn() };
}
beforeEach(() => { mocks.native.fetch.mockReset(); mocks.native.dispose.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it.each(["2026-11-02T12:00:01Z", "2026-11-02T11:59:59Z"])("verifies completed repair contents with snapshot timestamp %s without enqueueing work", async (savedAt) => {
  const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const meal = { id: "meal_synthetic", name: "Bean tacos", eatenAt: "2026-10-20T12:00:00Z", calories: 400,
    proteinGrams: 20, carbsGrams: 50, fatGrams: 10, uploadId: "synthetic-upload" };
  mocks.native.fetch.mockResolvedValue(response({ savedAt, days: [{ meals: [meal] }] }));
  const fetch = vi.fn().mockResolvedValue(response({ schemaVersion: 1,
    actionId: "2c77048c-61ba-56c4-8d47-e1f0ca065139", status: "applied", reason: null,
    completedAt: "2026-11-02T12:00:00Z", result: { kind: "meal.names.repair", version: 1, batch: 1,
      done: true, scanned: 1, renamed: 1, skipped: 0, invalid: 0, changed: 0 } }));
  const cookies = vi.fn().mockResolvedValue([{ name: "__Host-murph-auth-session", value: "x".repeat(32) }]);
  await runOwner({ cookies, request: { fetch } });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]![1].method).toBe("GET");
  expect(mocks.native.fetch).toHaveBeenCalledTimes(2);
  expect(mocks.native.dispose).toHaveBeenCalledTimes(1);
  expect(output).toHaveBeenCalledWith(expect.stringContaining('"apiPreserved":1'));
  expect(output).toHaveBeenCalledWith(expect.stringContaining('"scope":"batch"'));
  expect(output.mock.calls.flat().join("")).not.toMatch(/Bean tacos|meal_synthetic|synthetic-upload/u);
});

it("waits for stale invalid names to leave the Meals API even when its timestamp is newer", async () => {
  const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const legacy = { id: "meal_synthetic", name: "beans, rice and peas", eatenAt: "2026-10-20T12:00:00Z", calories: 400 };
  const current = { ...legacy, name: "Bean rice bowl" };
  const page = (meal: typeof legacy) => response({ savedAt: "2026-11-02T12:00:01Z", days: [{ meals: [meal] }] });
  mocks.native.fetch.mockResolvedValueOnce(page(legacy)).mockResolvedValueOnce(page(legacy)).mockResolvedValue(page(current));
  const fetch = vi.fn().mockResolvedValue(response({ schemaVersion: 1,
    actionId: "2c77048c-61ba-56c4-8d47-e1f0ca065139", status: "applied", reason: null,
    completedAt: "2026-11-02T12:00:00Z", result: { kind: "meal.names.repair", version: 1, batch: 1,
      done: true, scanned: 1, renamed: 1, skipped: 0, invalid: 0, changed: 0 } }));
  const cookies = vi.fn().mockResolvedValue([{ name: "__Host-murph-auth-session", value: "x".repeat(32) }]);
  await runOwner({ cookies, request: { fetch } });
  expect(mocks.native.fetch).toHaveBeenCalledTimes(3);
  expect(output).toHaveBeenCalledWith(expect.stringContaining('"apiInvalidNames":0'));
});

it.each(["HOSTED_CONSENT_REQUIRED", "HOSTED_ACCESS_REQUIRED"])("continues past explicit member denial %s and counts it without identifiers", async code => {
  const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const fetch = vi.fn()
    .mockResolvedValueOnce(response({ targets: ["synthetic-denied", "synthetic-allowed"], nextCursor: null }))
    .mockResolvedValueOnce(response({ status: "pending" }))
    .mockResolvedValueOnce({ ...response({ error: { code } }), ok: () => false, status: () => 403 })
    .mockResolvedValueOnce(response({ status: "pending" }))
    .mockResolvedValueOnce(response({ schemaVersion: 1,
      actionId: "2c77048c-61ba-56c4-8d47-e1f0ca065139", status: "applied", reason: null,
      completedAt: "2026-11-02T12:00:00Z", result: { kind: "meal.names.repair", version: 1, batch: 1,
        done: true, scanned: 1, renamed: 1, skipped: 0, invalid: 0, changed: 0 } }));
  await runAll({ fetch });
  const counts = JSON.parse(String(output.mock.calls.at(-1)![0]));
  expect(counts).toMatchObject({ scope: "all", members: 1, skippedMembers: 1, scanned: 1, renamed: 1,
    consentDenied: code === "HOSTED_CONSENT_REQUIRED" ? 1 : 0,
    accessDenied: code === "HOSTED_ACCESS_REQUIRED" ? 1 : 0 });
  expect(fetch).toHaveBeenCalledTimes(5);
  expect(output.mock.calls.flat().join("")).not.toMatch(/synthetic-denied|synthetic-allowed/u);
});

it.each([[401, "AUTH_REQUIRED"], [404, "HOSTED_OPS_ACCESS_DENIED"], [403, "ORIGIN_INVALID"], [500, "HOSTED_CONSENT_REQUIRED"]])("stops on HTTP %s with code %s instead of treating it as a member skip", async (status, code) => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(response({ targets: ["synthetic-first", "synthetic-second"], nextCursor: null }))
    .mockResolvedValueOnce(response({ status: "pending" }))
    .mockResolvedValueOnce({ ...response({ error: { code } }), ok: () => false, status: () => status });
  await expect(runAll({ fetch })).rejects.toThrow(`Ops meal repair HTTP ${status}`);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("stops when the operator access recheck fails", async () => {
  const denied = { ...response({ error: { code: "HOSTED_ACCESS_REQUIRED" } }), ok: () => false, status: () => 403 };
  const fetch = vi.fn().mockResolvedValueOnce(response({ targets: ["synthetic-first", "synthetic-second"], nextCursor: null }))
    .mockResolvedValueOnce(response({ status: "pending" })).mockResolvedValue(denied);
  await expect(runAll({ fetch })).rejects.toThrow("Ops meal repair HTTP 403");
  expect(fetch).toHaveBeenCalledTimes(4);
});

it("stops on a denial after completed batches so partial member counts are not silently discarded", async () => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const fetch = vi.fn().mockResolvedValueOnce(response({ targets: ["synthetic-first", "synthetic-second"], nextCursor: null }))
    .mockResolvedValueOnce(response({ schemaVersion: 1,
      actionId: "2c77048c-61ba-56c4-8d47-e1f0ca065139", status: "applied", reason: null,
      completedAt: "2026-11-02T12:00:00Z", result: { kind: "meal.names.repair", version: 1, batch: 1,
        done: false, scanned: 5, renamed: 5, skipped: 0, invalid: 0, changed: 0 } }))
    .mockResolvedValueOnce(response({ status: "pending" }))
    .mockResolvedValueOnce({ ...response({ error: { code: "HOSTED_CONSENT_REQUIRED" } }), ok: () => false, status: () => 403 });
  await expect(runAll({ fetch })).rejects.toThrow("Ops meal repair HTTP 403");
  expect(fetch).toHaveBeenCalledTimes(4);
});
