import { setTimeout as delay } from "node:timers/promises";
import type { HostedRuntimeGroupToolResponse } from "@murphai/hosted-execution/runtime-control";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHostedGroupSharedReader, type HostedGroupSharedReadTelemetry } from "../src/hosted-runtime/group-shared-reader.ts";

vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn() }));
const scope = { projectionKind: "sleep-duration-days.v0" } as const;
const freshness = [{ projectionScopeKey: scope.projectionKind, date: "2026-08-04" }];
const input = { projectionScopes: [scope], freshness };
function response(options: { available?: boolean; revoked?: boolean; refreshStatus?: "requested" | "unavailable" | "not_needed" } = {}): HostedRuntimeGroupToolResponse {
  return { action: "read_shared", result: {
    status: "ok", requestedProjectionScopeKeys: [scope.projectionKind],
    freshness: { checkedAt: new Date().toISOString(), refreshStatus: options.refreshStatus ?? "requested" },
    members: [{ memberId: "member_example", participantId: "participant_example", currentTurnHandles: [], displayName: "Rowan",
      projections: [{ projectionScope: scope, projectionScopeKey: scope.projectionKind,
        grantStatus: options.revoked ? "not_granted" : "granted", dataStatus: options.available ? "available" : "missing",
        records: options.available ? [{ recordKey: "day", occurredAt: "2026-08-04T00:00:00.000Z", data: {
          date: "2026-08-04", metricKey: "total-sleep-minutes", value: 420, unit: "minutes",
        } }] : [],
      }],
    }],
  } };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-08-04T14:20:00.000Z"));
  vi.mocked(delay).mockReset().mockImplementation(async (ms) => { await vi.advanceTimersByTimeAsync(ms ?? 0); });
});
afterEach(() => vi.useRealTimers());

describe("bounded shared wearable recovery", () => {
  it("rejects refresh arguments at a read-only reader before any Web I/O", async () => {
    const request = vi.fn().mockResolvedValue(response());
    const reader = createHostedGroupSharedReader({ groupToolPort: { request } });
    expect(await reader.request(input)).toEqual({ status: "unavailable", unavailableReason: "group_shared_request_invalid" });
    expect(request).not.toHaveBeenCalled();
    await reader.request({ projectionScopes: [scope] });
    expect(request).toHaveBeenCalledExactlyOnceWith({ action: "read_shared", projectionScopes: [scope] });
  });
  it("requests sync once, then rereads consented data until the requested day arrives", async () => {
    const request = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response({ available: true }));
    const reader = createHostedGroupSharedReader({ groupToolPort: { request }, freshnessWaitMs: 300_000 });
    const result = await reader.request(input);
    expect(request.mock.calls).toEqual([[{ action: "read_shared", ...input }], [{ action: "read_shared", projectionScopes: [scope] }]]);
    expect(result).toMatchObject({ freshness: { refreshStatus: "requested", checkedAt: "2026-08-04T14:20:15.000Z" }, members: [{ projections: [{ dataStatus: "available" }] }] });
  });
  it("waits for the missing source even when another source already has the date", async () => {
    const first = response({ available: true });
    if (first.action !== "read_shared" || first.result.status !== "ok") throw new Error("Expected shared response");
    const projection = first.result.members[0]!.projections[0]!;
    const current = { ...projection.records[0]!, source: { source: "garmin", label: "Garmin" } };
    const previous = { recordKey: "prior.oura", occurredAt: "2026-08-03T00:00:00.000Z",
      source: { source: "oura", label: "Oura" }, data: { date: "2026-08-03", metricKey: "total-sleep-minutes", value: 420, unit: "minutes" } };
    projection.records = [current, previous];
    const second = structuredClone(first);
    if (second.action !== "read_shared" || second.result.status !== "ok") throw new Error("Expected shared response");
    second.result.members[0]!.projections[0]!.records = [...projection.records, { ...current, recordKey: "current.oura", source: previous.source }];
    const request = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    await createHostedGroupSharedReader({ groupToolPort: { request }, freshnessWaitMs: 300_000 }).request(input);
    expect(request).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
  });
  it("stops waiting once recent dates arrive even when historical gaps remain", async () => {
    const request = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response({ available: true }));
    const result = await createHostedGroupSharedReader({ groupToolPort: { request }, freshnessWaitMs: 300_000 }).request({
      ...input, freshness: [...freshness, { ...freshness[0]!, date: "2026-07-01" }],
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ freshness: { refreshStatus: "requested" } });
  });
  it("does not wait for historical-only gaps even with an older Web requested response", async () => {
    const request = vi.fn().mockResolvedValue(response());
    await createHostedGroupSharedReader({ groupToolPort: { request }, freshnessWaitMs: 300_000 }).request({
      ...input, freshness: [{ ...freshness[0]!, date: "2026-07-01" }],
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });
  it("stops after five minutes and retains missing data without zero records", async () => {
    const request = vi.fn().mockImplementation(async () => response());
    const result = await createHostedGroupSharedReader({ groupToolPort: { request }, freshnessWaitMs: 900_000 }).request(input);
    expect(request).toHaveBeenCalledTimes(21);
    expect(request.mock.calls.filter(([value]) => value.freshness)).toHaveLength(1);
    expect(result).toMatchObject({ freshness: { checkedAt: "2026-08-04T14:25:00.000Z" }, members: [{ projections: [{ records: [] }] }] });
  });
  it.each([{ available: true }, { revoked: true }, { refreshStatus: "unavailable" as const }])("returns immediately when waiting cannot help (%j)", async (options) => {
    const request = vi.fn().mockResolvedValue(response(options));
    await createHostedGroupSharedReader({ groupToolPort: { request }, freshnessWaitMs: 15_000 }).request(input);
    expect(request).toHaveBeenCalledTimes(1); expect(delay).not.toHaveBeenCalled();
  });
  it("drops a revoked grant on the next read", async () => {
    const revoked = response({ revoked: true });
    const request = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(revoked);
    const result = await createHostedGroupSharedReader({ groupToolPort: { request }, freshnessWaitMs: 15_000 }).request(input);
    expect(result).toMatchObject({ members: [{ projections: [{ grantStatus: "not_granted", records: [] }] }] });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("falls back on an older producer without claiming a successful refresh", async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error("unsupported field")).mockResolvedValueOnce(response());
    const result = await createHostedGroupSharedReader({ groupToolPort: { request }, freshnessWaitMs: 15_000 }).request(input);
    expect(result).toMatchObject({ freshness: { refreshStatus: "unavailable" } });
    expect(request).toHaveBeenLastCalledWith({ action: "read_shared", projectionScopes: [scope] });
    expect(delay).not.toHaveBeenCalled();
  });
  it("propagates cancellation without a fallback read", async () => {
    const controller = new AbortController();
    vi.mocked(delay).mockImplementationOnce(async () => { controller.abort(); throw controller.signal.reason; });
    const request = vi.fn().mockResolvedValue(response());
    await expect(createHostedGroupSharedReader({ groupToolPort: { request }, freshnessWaitMs: 15_000 }).request(input, { signal: controller.signal })).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
});


function mixedResponse(recentArrived: boolean): HostedRuntimeGroupToolResponse {
  const base = response();
  if (base.action !== "read_shared" || base.result.status !== "ok") throw new Error("Expected shared response");
  const member = base.result.members[0]!;
  const original = member.projections[0]!;
  return { action: "read_shared", result: { ...base.result, members: [0, 1, 2, 3].map((index) => ({
    ...member, memberId: `member_${index}`, participantId: `participant_${index}`,
    projections: [{ ...original, grantedAt: "2026-07-01T00:00:00.000Z", records: index === 3 ? []
      : ["2026-08-03", ...(index === 0 || recentArrived ? ["2026-08-04"] : [])].map((date) => ({
        recordKey: date, occurredAt: `${date}T00:00:00.000Z`, data: { date, metricKey: "total-sleep-minutes", value: 435, unit: "minutes" },
      })) }],
  })) } };
}

describe("mixed reporting history recovery", () => {
  it("does not wait for an established nonreporter when recent contributors are complete", async () => {
    const current = mixedResponse(true);
    const request = vi.fn().mockResolvedValue(current);
    const result = await createHostedGroupSharedReader({ groupToolPort: { request }, freshnessWaitMs: 300_000 }).request(input);
    if (current.action !== "read_shared") throw new Error("Expected read response");
    expect(result).toEqual(current.result);
    expect(request).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });
  it("waits for unexpectedly missing contributors and stops when they arrive despite an ongoing absence", async () => {
    const request = vi.fn().mockResolvedValueOnce(mixedResponse(false)).mockResolvedValueOnce(mixedResponse(true));
    const result = await createHostedGroupSharedReader({ groupToolPort: { request }, freshnessWaitMs: 300_000 }).request(input);
    expect(request).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledExactlyOnceWith(15_000, undefined, { signal: undefined });
    expect(result).toMatchObject({ freshness: { checkedAt: "2026-08-04T14:20:15.000Z" } });
    if (result.status !== "ok") throw new Error("Expected shared results");
    expect(result.members.slice(0, 3).every((member) => member.projections[0]?.records.some((record) => "date" in record.data && record.data.date === "2026-08-04"))).toBe(true);
    expect(result.members[3]?.projections[0]?.records).toEqual([]);
  });
});

describe("shared read timing telemetry", () => {
  const telemetryKeys = [
    "groupSharedReadCallbackCount", "groupSharedReadCallbackElapsedMs", "groupSharedReadCallbackMaxElapsedMs",
    "groupSharedReadDecision", "groupSharedReadElapsedMs", "groupSharedReadFreshnessRequested",
    "groupSharedReadOutcome", "groupSharedReadPollCount", "groupSharedReadPollElapsedMs", "groupSharedReadWaitBudgetMs",
  ];
  function observed() {
    const records: HostedGroupSharedReadTelemetry[] = [];
    return { records, onReadCompleted: (telemetry: HostedGroupSharedReadTelemetry) => { records.push(telemetry); } };
  }

  it("attributes a five-minute deadline to 20 polls and 21 instant callbacks with one exact record", async () => {
    const { records, onReadCompleted } = observed();
    const request = vi.fn().mockImplementation(async () => response());
    await createHostedGroupSharedReader({ groupToolPort: { request }, freshnessWaitMs: 300_000, onReadCompleted }).request(input);
    expect(request).toHaveBeenCalledTimes(21);
    expect(request.mock.calls.filter(([value]) => value.freshness)).toHaveLength(1);
    expect(records).toEqual([{
      groupSharedReadCallbackCount: 21, groupSharedReadCallbackElapsedMs: 0, groupSharedReadCallbackMaxElapsedMs: 0,
      groupSharedReadDecision: "deadline", groupSharedReadElapsedMs: 300_000, groupSharedReadFreshnessRequested: true,
      groupSharedReadOutcome: "ok", groupSharedReadPollCount: 20, groupSharedReadPollElapsedMs: 300_000,
      groupSharedReadWaitBudgetMs: 300_000,
    }]);
    expect(Object.keys(records[0]!).sort()).toEqual(telemetryKeys);
    expect(JSON.stringify(records)).not.toMatch(/2026|member|participant|sleep|Rowan|minutes/u);
  });

  it("separates slow Web callbacks from intentional poll sleep and records an early stop", async () => {
    const { records, onReadCompleted } = observed();
    const request = vi.fn()
      .mockImplementationOnce(async () => { await vi.advanceTimersByTimeAsync(1_000); return response(); })
      .mockImplementationOnce(async () => { await vi.advanceTimersByTimeAsync(4_000); return response({ available: true }); });
    await createHostedGroupSharedReader({ groupToolPort: { request }, freshnessWaitMs: 300_000, onReadCompleted }).request(input);
    expect(request).toHaveBeenCalledTimes(2);
    expect(records).toEqual([expect.objectContaining({
      groupSharedReadCallbackCount: 2, groupSharedReadCallbackElapsedMs: 5_000, groupSharedReadCallbackMaxElapsedMs: 4_000,
      groupSharedReadDecision: "satisfied", groupSharedReadElapsedMs: 20_000,
      groupSharedReadPollCount: 1, groupSharedReadPollElapsedMs: 15_000,
    })]);
  });

  function withoutFreshness(): HostedRuntimeGroupToolResponse {
    const current = response();
    if (current.action === "read_shared" && current.result.status === "ok") delete current.result.freshness;
    return current;
  }
  it.each([
    ["refresh unavailable", response({ refreshStatus: "unavailable" }), "refresh_unavailable"],
    ["freshness absent", withoutFreshness(), "refresh_unavailable"],
    ["refresh not needed", response({ refreshStatus: "not_needed" }), "not_needed"],
    ["requested day present", response({ available: true }), "satisfied"],
    ["non-ok result", { action: "read_shared", result: { status: "unavailable", unavailableReason: "synthetic" } }, "not_ok"],
  ] as const)("records a no-wait terminal decision (%s)", async (_label, current, decision) => {
    const { records, onReadCompleted } = observed();
    const request = vi.fn().mockResolvedValue(current);
    await createHostedGroupSharedReader({ groupToolPort: { request }, freshnessWaitMs: 15_000, onReadCompleted }).request(input);
    expect(request).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
    expect(records).toEqual([expect.objectContaining({
      groupSharedReadCallbackCount: 1, groupSharedReadDecision: decision, groupSharedReadPollCount: 0,
    })]);
  });

  it("classifies an invalid response and a failed fallback without exception text", async () => {
    const { records, onReadCompleted } = observed();
    const invalid = vi.fn().mockResolvedValue({ action: "ask", result: {} });
    expect(await createHostedGroupSharedReader({ groupToolPort: { request: invalid }, freshnessWaitMs: 15_000, onReadCompleted })
      .request(input)).toEqual({ status: "unavailable", unavailableReason: "group_shared_result_invalid" });
    const failed = vi.fn().mockRejectedValueOnce(new Error("secret initial failure"))
      .mockRejectedValueOnce(new Error("secret fallback failure"));
    expect(await createHostedGroupSharedReader({ groupToolPort: { request: failed }, freshnessWaitMs: 15_000, onReadCompleted })
      .request(input)).toEqual({ status: "unavailable", unavailableReason: "group_shared_read_failed" });
    expect(records).toEqual([
      expect.objectContaining({ groupSharedReadCallbackCount: 1, groupSharedReadDecision: "invalid", groupSharedReadOutcome: "unavailable" }),
      expect.objectContaining({ groupSharedReadCallbackCount: 2, groupSharedReadDecision: "error", groupSharedReadOutcome: "unavailable" }),
    ]);
    expect(JSON.stringify(records)).not.toMatch(/secret|failure/u);
  });

  it("records plain reads, non-ok results, and skips rejected requests", async () => {
    const { records, onReadCompleted } = observed();
    const request = vi.fn().mockResolvedValueOnce(response())
      .mockResolvedValueOnce({ action: "read_shared", result: { status: "unavailable", unavailableReason: "synthetic" } });
    const reader = createHostedGroupSharedReader({ groupToolPort: { request }, onReadCompleted });
    await reader.request(input);
    await reader.request({ projectionScopes: [scope] });
    await reader.request({ projectionScopes: [scope] });
    expect(records).toEqual([
      expect.objectContaining({ groupSharedReadDecision: "no_freshness", groupSharedReadFreshnessRequested: false,
        groupSharedReadOutcome: "ok", groupSharedReadWaitBudgetMs: 0 }),
      expect.objectContaining({ groupSharedReadDecision: "no_freshness", groupSharedReadOutcome: "unavailable" }),
    ]);
  });

  it("keeps Web no-data distinct from unavailable", async () => {
    const { records, onReadCompleted } = observed();
    const none = { action: "read_shared", result: { members: [], requestedProjectionScopeKeys: ["sleep-duration-days.v0"], status: "none" } } as const;
    const request = vi.fn().mockResolvedValue(none);
    const reader = createHostedGroupSharedReader({ groupToolPort: { request }, freshnessWaitMs: 15_000, onReadCompleted });
    expect(await reader.request(input)).toEqual(none.result);
    expect(await reader.request({ projectionScopes: [scope] })).toEqual(none.result);
    expect(records).toEqual([
      expect.objectContaining({ groupSharedReadDecision: "not_ok", groupSharedReadOutcome: "none" }),
      expect.objectContaining({ groupSharedReadDecision: "no_freshness", groupSharedReadOutcome: "none" }),
    ]);
  });

  it("records an accepted already-aborted read as canceled with zero callbacks", async () => {
    const { records, onReadCompleted } = observed();
    const controller = new AbortController();
    const reason = new Error("synthetic pre-abort");
    controller.abort(reason);
    const request = vi.fn();
    await expect(createHostedGroupSharedReader({ groupToolPort: { request }, freshnessWaitMs: 15_000, onReadCompleted })
      .request(input, { signal: controller.signal })).rejects.toBe(reason);
    expect(request).not.toHaveBeenCalled();
    expect(records).toEqual([expect.objectContaining({
      groupSharedReadCallbackCount: 0, groupSharedReadDecision: "canceled", groupSharedReadOutcome: "canceled",
      groupSharedReadPollCount: 0,
    })]);
  });

  it("records fallback and cancellation without claiming completion", async () => {
    const { records, onReadCompleted } = observed();
    const fallback = vi.fn().mockRejectedValueOnce(new Error("unsupported field")).mockResolvedValueOnce(response());
    await createHostedGroupSharedReader({ groupToolPort: { request: fallback }, freshnessWaitMs: 15_000, onReadCompleted }).request(input);
    const controller = new AbortController();
    const reason = new Error("synthetic abort");
    vi.mocked(delay).mockImplementationOnce(async () => {
      await vi.advanceTimersByTimeAsync(4_000); controller.abort(reason); throw controller.signal.reason;
    });
    const canceled = vi.fn().mockResolvedValue(response());
    await expect(createHostedGroupSharedReader({ groupToolPort: { request: canceled }, freshnessWaitMs: 15_000, onReadCompleted })
      .request(input, { signal: controller.signal })).rejects.toBe(reason);
    expect(canceled).toHaveBeenCalledTimes(1);
    expect(records).toEqual([
      expect.objectContaining({ groupSharedReadCallbackCount: 2, groupSharedReadDecision: "fallback", groupSharedReadOutcome: "ok" }),
      expect.objectContaining({ groupSharedReadCallbackCount: 1, groupSharedReadDecision: "canceled", groupSharedReadElapsedMs: 4_000,
        groupSharedReadOutcome: "canceled", groupSharedReadPollCount: 1, groupSharedReadPollElapsedMs: 4_000 }),
    ]);
  });

  it.each([
    ["throws", () => { throw new Error("observer failed"); }],
    ["rejects", () => Promise.reject(new Error("observer failed"))],
    ["never settles", () => new Promise<void>(() => undefined)],
  ])("keeps the read result when the observer %s", async (_label, onReadCompleted) => {
    const current = response({ available: true });
    const request = vi.fn().mockResolvedValue(current);
    const result = await createHostedGroupSharedReader({ groupToolPort: { request }, freshnessWaitMs: 15_000, onReadCompleted }).request(input);
    if (current.action !== "read_shared") throw new Error("Expected read response");
    expect(result).toEqual(current.result);
    await vi.advanceTimersByTimeAsync(0);
  });
});
