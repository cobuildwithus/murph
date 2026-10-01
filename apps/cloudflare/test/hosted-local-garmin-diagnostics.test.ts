import { afterEach, describe, expect, it, vi } from "vitest";

import { readLiveGarminProviderDiagnosticsForLog, summarizeLiveGarminProviderDiagnostics } from "./helpers/hosted-local-garmin-diagnostics.js";

const window = { from: "2026-08-01", to: "2026-08-14" };
const userId = "synthetic-provider-user";

describe("live Garmin provider diagnostics", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("reports only closed resource, window, and history categories for the requested identity", () => {
    const summary = summarizeLiveGarminProviderDiagnostics({
      userId, window,
      availability: { data: [
        { user_id: "unrelated-user", provider: { garmin: { activity: { newest_data: "2026-08-12T00:00:00Z" } } } },
        { user_id: userId, provider: { garmin: {
          activity: { newest_data: "2026-07-31T00:00:00Z", sent_count: 45 },
          sleep: { newestData: new Date("2026-08-14T00:00:00Z") },
          workouts: { newest_data: "2026-08-16T00:00:00Z" },
          private_resource: { newest_data: "private-value" },
        } } },
      ] },
      history: { matchedUser: true, sources: [{
        sourceProviderSlug: "garmin", notPulledResources: ["workouts"],
        pulledResources: [
          { resource: "activity", status: "success", daysWithData: 45, errorDetails: "private-error", rangeStart: null, rangeEnd: null },
          { resource: "sleep", status: "private-status", daysWithData: null, errorDetails: null, rangeStart: null, rangeEnd: null },
        ],
      }] },
    });
    expect(summary).toEqual([
      { resource: "activity", inventory: "present", latestData: "before_window", history: "success", historyRequestedWindow: "unknown", historyReportedData: "present" },
      { resource: "sleep", inventory: "present", latestData: "in_window", history: "unknown", historyRequestedWindow: "unknown", historyReportedData: "unknown" },
      { resource: "workouts", inventory: "present", latestData: "after_window", history: "not_pulled", historyRequestedWindow: "unknown", historyReportedData: "unknown" },
    ]);
    expect(JSON.stringify(summary)).not.toMatch(/private|2026|45|synthetic|unrelated/u);
  });

  it("does not infer availability from another user, provider, or invalid dates", () => {
    for (const availability of [null, { data: [] }, { data: [{
      userId,
      provider: {
        oura: { activity: { newest_data: "2026-08-12T00:00:00Z" } },
        garmin: { activity: { newest_data: "2026-08-12Tprivate" } },
      },
    }] }, { data: [{ user_id: "unrelated-user", provider: { garmin: {
      activity: { newest_data: "2026-08-12T00:00:00Z" },
    } } }] }]) {
      expect(summarizeLiveGarminProviderDiagnostics({
        availability, history: { matchedUser: false, sources: [] }, userId, window,
      })).toMatchObject(["activity", "sleep", "workouts"].map((resource) => ({
        resource, latestData: "unknown", history: "unknown",
      })));
    }
  });

  it.each([
    [null, null, null, "unknown", "unknown"],
    ["2026-08-01T00:00:00Z", null, 0, "unknown", "empty"],
    ["invalid-private-date", "2026-08-14T23:59:59Z", 2, "invalid", "present"],
    ["2026-08-14T00:00:00Z", "2026-08-01T00:00:00Z", -1, "invalid", "unknown"],
    ["2026-07-01T00:00:00Z", "2026-07-31T23:59:59.999Z", 0, "before_window", "empty"],
    ["2026-08-15T00:00:00Z", "2026-08-16T00:00:00Z", 1, "after_window", "present"],
    ["2026-07-01T00:00:00Z", "2026-08-01T00:00:00Z", 1, "overlaps_window", "present"],
    ["2026-08-14T23:59:59.999Z", "2026-08-16T00:00:00Z", 0, "overlaps_window", "empty"],
    ["2026-08-03T12:00:00Z", "2026-08-04T12:00:00Z", 0.5, "overlaps_window", "unknown"],
    ["2026-07-01T00:00:00Z", "2026-09-01T00:00:00Z", Number.NaN, "overlaps_window", "unknown"],
  ])("classifies requested history separately from delivery (%s to %s)", (rangeStart, rangeEnd, daysWithData, historyRequestedWindow, historyReportedData) => {
    const summary = summarizeLiveGarminProviderDiagnostics({
      availability: null, userId, window,
      history: { matchedUser: true, sources: [{
        sourceProviderSlug: "garmin", notPulledResources: [], pulledResources: [{
          resource: "activity", status: "success", rangeStart, rangeEnd, daysWithData, errorDetails: "private-error",
        }],
      }] },
    });
    expect(summary[0]).toMatchObject({ historyRequestedWindow, historyReportedData, latestData: "unknown" });
    expect(JSON.stringify(summary)).not.toMatch(/2026|private|synthetic|NaN/u);
  });

  it.each([[false, "garmin"], [true, "oura"]])("does not report history belonging to another identity (%s, %s)", (matchedUser, sourceProviderSlug) => {
    const summary = summarizeLiveGarminProviderDiagnostics({
      availability: null, userId, window,
      history: { matchedUser, sources: [{
        sourceProviderSlug, notPulledResources: [], pulledResources: [{
          resource: "activity", status: "success", daysWithData: 12, errorDetails: null,
          rangeStart: "2026-08-01T00:00:00Z", rangeEnd: "2026-08-14T23:59:59Z",
        }],
      }] },
    });
    expect(summary[0]).toMatchObject({ history: "unknown", historyRequestedWindow: "unknown", historyReportedData: "unknown" });
  });

  it("keeps either API failure private while preserving the other diagnostic", async () => {
    const client = {
      listSummary: vi.fn().mockResolvedValue([]),
      introspectResources: vi.fn().mockRejectedValue(new Error("private API body")),
      introspectHistoricalPull: vi.fn().mockResolvedValue({ matchedUser: true, sources: [{
        sourceProviderSlug: "garmin", notPulledResources: ["activity"], pulledResources: [],
      }] }),
    };
    const result = JSON.parse(await readLiveGarminProviderDiagnosticsForLog({
      client, userId, window, signal: new AbortController().signal,
    }));
    expect(result.resourcesQuery).toBe("rejected");
    expect(result.historyQuery).toBe("fulfilled");
    expect(result.resources[0]).toEqual({ resource: "activity", inventory: "invalid_response", latestData: "unknown", history: "not_pulled", historyRequestedWindow: "unknown", historyReportedData: "unknown", historyRangeData: "empty" });
    expect(client.introspectResources).toHaveBeenCalledWith({
      userId, userLimit: 1, sourceProviderSlug: "garmin", signal: expect.any(AbortSignal),
    });
    expect(JSON.stringify(result)).not.toMatch(/private|synthetic/u);
  });

  it("distinguishes absent inventory owners from a resource without a timestamp", () => {
    const cases = [
      [null, "invalid_response"],
      [{ data: [] }, "user_missing"],
      [{ data: [{ userId, provider: {} }] }, "provider_missing"],
      [{ data: [{ userId, provider: { garmin: {} } }] }, "resource_missing"],
      [{ data: [{ userId, provider: { garmin: { activity: {} } } }] }, "present"],
    ] as const;
    for (const [availability, inventory] of cases) {
      expect(summarizeLiveGarminProviderDiagnostics({ availability, history: null, userId, window })[0])
        .toMatchObject({ inventory, latestData: "unknown" });
    }
  });

  it("probes all three resource types across history without exposing records or changing the proof", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-16T12:00:00Z"));
    const listSummary = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ source: { provider: "garmin" }, privateValue: "private-health" }])
      .mockResolvedValueOnce([{ source: { provider: "oura" }, privateValue: "private-health" }]);
    const serialized = await readLiveGarminProviderDiagnosticsForLog({
      client: {
        listSummary,
        introspectResources: vi.fn().mockResolvedValue({ data: [] }),
        introspectHistoricalPull: vi.fn().mockResolvedValue({ matchedUser: false, sources: [] }),
      },
      userId, window, signal: new AbortController().signal,
    });
    expect(JSON.parse(serialized).resources.map((row: { historyRangeData: string }) => row.historyRangeData))
      .toEqual(["empty", "present", "provider_mismatch"]);
    for (const [index, resource] of ["activity", "sleep", "workouts"].entries()) {
      expect(listSummary).toHaveBeenNthCalledWith(index + 1, {
        collectionWorkLimit: { maxAttemptsPerPage: 1, maxPages: 3, requestTimeoutMs: 8_000 },
        maxRecords: 500,
        requireStructurallyCompleteCollection: true,
        resource, userId, sourceProviderSlug: "garmin", signal: expect.any(AbortSignal),
        windowStart: "2026-05-18T12:00:00.000Z",
        windowEnd: "2026-08-16T12:00:00.000Z",
      });
    }
    expect(serialized).not.toMatch(/private|2026|synthetic|oura/u);
  });

  it("bounds stalled introspection within the browser cleanup grace period", async () => {
    const timeout = AbortSignal.timeout(20);
    const deadline = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout);
    const query = vi.fn(async ({ signal }: { signal?: AbortSignal | null }) => {
      await new Promise((_, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("private timeout")), { once: true });
      });
      throw new Error("unreachable");
    });
    const result = JSON.parse(await readLiveGarminProviderDiagnosticsForLog({
      client: { introspectResources: query, introspectHistoricalPull: query, listSummary: query },
      userId, window, signal: new AbortController().signal,
    }));
    expect(deadline).toHaveBeenCalledWith(10_000);
    expect(query).toHaveBeenCalledTimes(5);
    expect(result.resources.every((row: { historyRangeData: string }) => row.historyRangeData === "unavailable")).toBe(true);
    expect(result.resourcesQuery).toBe("rejected");
    expect(result.historyQuery).toBe("rejected");
    expect(JSON.stringify(result)).not.toContain("private");
  });
});
