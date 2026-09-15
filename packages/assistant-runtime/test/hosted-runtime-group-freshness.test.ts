import { setTimeout as delay } from "node:timers/promises";
import type { HostedRuntimeGroupToolResponse } from "@murphai/hosted-execution/runtime-control";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHostedGroupSharedReader } from "../src/hosted-runtime/group-shared-reader.ts";

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
