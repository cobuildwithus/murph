import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ native: { fetch: vi.fn(), dispose: vi.fn() } }));
vi.mock("@playwright/test", () => ({ chromium: {}, request: { newContext: vi.fn(async () => mocks.native) } }));
import { runOwner } from "../scripts/ops-meal-name-repair";

function response(body: unknown) {
  return { ok: () => true, body: async () => Buffer.from(JSON.stringify(body)), dispose: vi.fn() };
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it("verifies an already completed owner repair without waiting for another snapshot or enqueueing work", async () => {
  const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const meal = { id: "meal_synthetic", name: "Bean tacos", eatenAt: "2026-10-20T12:00:00Z", calories: 400,
    proteinGrams: 20, carbsGrams: 50, fatGrams: 10, uploadId: "synthetic-upload" };
  mocks.native.fetch.mockResolvedValue(response({ savedAt: "2026-11-02T12:00:01Z", days: [{ meals: [meal] }] }));
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
  expect(output.mock.calls.flat().join("")).not.toMatch(/Bean tacos|meal_synthetic|synthetic-upload/u);
});
