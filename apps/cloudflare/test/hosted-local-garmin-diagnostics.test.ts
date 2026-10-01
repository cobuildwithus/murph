import { afterEach, describe, expect, it, vi } from "vitest";

import { readLiveGarminProviderDiagnostics, summarizeLiveGarminProviderDiagnostics } from "./helpers/hosted-local-garmin-diagnostics.js";

const window = { from: "2026-08-01", to: "2026-08-14" };
const userId = "synthetic-provider-user";

describe("live Garmin provider diagnostics", () => {
  afterEach(() => vi.restoreAllMocks());

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
      { resource: "activity", latestData: "before_window", history: "success" },
      { resource: "sleep", latestData: "in_window", history: "unknown" },
      { resource: "workouts", latestData: "after_window", history: "not_pulled" },
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
      })).toEqual(["activity", "sleep", "workouts"].map((resource) => ({
        resource, latestData: "unknown", history: "unknown",
      })));
    }
  });

  it("keeps either API failure private while preserving the other diagnostic", async () => {
    const client = {
      introspectResources: vi.fn().mockRejectedValue(new Error("private API body")),
      introspectHistoricalPull: vi.fn().mockResolvedValue({ matchedUser: true, sources: [{
        sourceProviderSlug: "garmin", notPulledResources: ["activity"], pulledResources: [],
      }] }),
    };
    const result = JSON.parse(await readLiveGarminProviderDiagnostics({
      client, userId, window, signal: new AbortController().signal,
    }));
    expect(result.resourcesQuery).toBe("rejected");
    expect(result.historyQuery).toBe("fulfilled");
    expect(result.resources[0]).toEqual({ resource: "activity", latestData: "unknown", history: "not_pulled" });
    expect(client.introspectResources).toHaveBeenCalledWith({
      userId, userLimit: 1, sourceProviderSlug: "garmin", signal: expect.any(AbortSignal),
    });
    expect(JSON.stringify(result)).not.toMatch(/private|synthetic/u);
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
    const result = JSON.parse(await readLiveGarminProviderDiagnostics({
      client: { introspectResources: query, introspectHistoricalPull: query },
      userId, window, signal: new AbortController().signal,
    }));
    expect(deadline).toHaveBeenCalledWith(10_000);
    expect(result.resourcesQuery).toBe("rejected");
    expect(result.historyQuery).toBe("rejected");
    expect(JSON.stringify(result)).not.toContain("private");
  });
});
