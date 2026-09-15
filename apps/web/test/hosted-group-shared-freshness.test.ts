import type { HostedRuntimeGroupSharedReadResult } from "@murphai/hosted-execution/runtime-control";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn(), grants: vi.fn(), connections: vi.fn(), wake: vi.fn() }));
vi.mock("@/src/lib/hosted-groups/group-store", () => ({ readHostedGroupSharedDataByRuntimeMemberId: mocks.read }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({
  hostedVaultShare: { findMany: mocks.grants }, deviceConnection: { findMany: mocks.connections },
}) }));
vi.mock("@/src/lib/device-sync/wake-service", () => ({ appendHostedDeviceSyncManualReconcileWake: mocks.wake }));
import { readHostedGroupSharedDataWithFreshness } from "@/src/lib/hosted-groups/shared-freshness";

const scope = { projectionKind: "sleep-duration-days.v0" } as const;
const freshness = [{ projectionScopeKey: scope.projectionKind, date: "2026-08-04" }];
const input = { runtimeMemberId: "runtime_example", projectionScopes: [scope], freshness };
function snapshot(options: { available?: boolean; granted?: boolean } = {}): HostedRuntimeGroupSharedReadResult {
  return { status: "ok", requestedProjectionScopeKeys: [scope.projectionKind], members: [{
    memberId: "member_example", participantId: "participant_example", currentTurnHandles: [], displayName: "Rowan",
    projections: [{ projectionScope: scope, projectionScopeKey: scope.projectionKind,
      grantStatus: options.granted === false ? "not_granted" : "granted", dataStatus: options.available ? "available" : "missing",
      records: options.available ? [{ recordKey: "day", occurredAt: "2026-08-04T00:00:00.000Z", data: {
        date: "2026-08-04", metricKey: "total-sleep-minutes", value: 420, unit: "minutes",
      } }] : [],
    }],
  }] };
}
const connection = { id: "connection_example", userId: "member_example", provider: "junction", connectedAt: new Date("2026-07-01T00:00:00.000Z") };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-08-04T14:22:00.000Z"));
  vi.resetAllMocks(); mocks.read.mockResolvedValue(snapshot());
  mocks.grants.mockResolvedValue([{ grantorMemberId: "member_example" }]);
  mocks.connections.mockResolvedValue([connection]); mocks.wake.mockResolvedValue({ wakeAccepted: true });
});
afterEach(() => vi.useRealTimers());

describe("shared wearable sync requests", () => {
  it("queues the canonical wake for an eligible member and returns only a new consent-filtered read", async () => {
    const updated = snapshot({ available: true }); mocks.read.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(updated);
    const result = await readHostedGroupSharedDataWithFreshness(input);
    expect(mocks.wake).toHaveBeenCalledExactlyOnceWith({ connectionId: connection.id, userId: connection.userId,
      provider: "junction", expectedConnectedAt: connection.connectedAt.toISOString(), occurredAt: "2026-08-04T14:20:00.000Z" });
    expect(mocks.grants).toHaveBeenCalledWith(expect.objectContaining({ take: 33, where: expect.objectContaining({
      destinationMemberId: "runtime_example", status: "granted",
      OR: [{ grantorMemberId: "member_example", projectionScopeKey: { in: [scope.projectionKind] } }],
      grantor: expect.objectContaining({ hostedGroupMemberships: { some: { group: { runtimeMemberId: "runtime_example" } } }, AND: expect.any(Array) }),
    }) }));
    expect(result).toEqual({ ...updated, freshness: { checkedAt: "2026-08-04T14:22:00.000Z", refreshStatus: "requested" } });
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain(connection.id);
  });
  it.each([{ available: true }, { granted: false }])("does no sync work for fresh or unshared data (%j)", async (options) => {
    mocks.read.mockResolvedValue(snapshot(options));
    expect(await readHostedGroupSharedDataWithFreshness(input)).toMatchObject({ freshness: { refreshStatus: "not_needed" } });
    expect(mocks.grants).not.toHaveBeenCalled(); expect(mocks.wake).not.toHaveBeenCalled();
  });
  it("keeps ordinary reads unchanged", async () => {
    const result = await readHostedGroupSharedDataWithFreshness({ runtimeMemberId: input.runtimeMemberId, projectionScopes: [scope] });
    expect(result).toEqual(snapshot()); expect(mocks.read).toHaveBeenCalledTimes(1); expect(mocks.grants).not.toHaveBeenCalled();
  });
  it("does not sync when eligibility was lost, and drops revoked data on reread", async () => {
    mocks.grants.mockResolvedValue([]); mocks.read.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot({ granted: false }));
    expect(await readHostedGroupSharedDataWithFreshness(input)).toMatchObject({ freshness: { refreshStatus: "unavailable" }, members: [{ projections: [{ grantStatus: "not_granted", records: [] }] }] });
    expect(mocks.connections).not.toHaveBeenCalled(); expect(mocks.wake).not.toHaveBeenCalled();
  });
  it("reuses a five-minute wake identity and fences a new connection incarnation", async () => {
    await readHostedGroupSharedDataWithFreshness(input);
    vi.setSystemTime(new Date("2026-08-04T14:24:00.000Z")); await readHostedGroupSharedDataWithFreshness(input);
    expect(mocks.wake.mock.calls[0]).toEqual(mocks.wake.mock.calls[1]);
    mocks.connections.mockResolvedValue([{ ...connection, connectedAt: new Date("2026-08-04T14:23:00.000Z") }]);
    await readHostedGroupSharedDataWithFreshness(input);
    expect(mocks.wake).toHaveBeenLastCalledWith(expect.objectContaining({ expectedConnectedAt: "2026-08-04T14:23:00.000Z", occurredAt: "2026-08-04T14:23:00.000Z" }));
  });
  it("caps concurrent wake work at four for the maximum admitted connection set", async () => {
    mocks.connections.mockResolvedValue(Array.from({ length: 32 }, (_, i) => ({ ...connection, id: `connection_${i}` })));
    let active = 0;
    let peak = 0;
    mocks.wake.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return { wakeAccepted: true };
    });
    expect(await readHostedGroupSharedDataWithFreshness(input)).toMatchObject({ freshness: { refreshStatus: "requested" } });
    expect(mocks.wake).toHaveBeenCalledTimes(32);
    expect(peak).toBe(4);
    expect(mocks.grants).toHaveBeenCalledTimes(1);
    expect(mocks.connections).toHaveBeenCalledTimes(1);
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });
  it("rejects excessive eligible-member fanout before looking up connections", async () => {
    mocks.grants.mockResolvedValue(Array.from({ length: 33 }, (_, i) => ({ grantorMemberId: `member_${i}` })));
    expect(await readHostedGroupSharedDataWithFreshness(input)).toMatchObject({ freshness: { refreshStatus: "unavailable" } });
    expect(mocks.connections).not.toHaveBeenCalled();
    expect(mocks.wake).not.toHaveBeenCalled();
  });
  it("bounds connection fanout before issuing any wake", async () => {
    mocks.connections.mockResolvedValue(Array.from({ length: 33 }, (_, i) => ({ ...connection, id: `connection_${i}` })));
    expect(await readHostedGroupSharedDataWithFreshness(input)).toMatchObject({ freshness: { refreshStatus: "unavailable" } });
    expect(mocks.wake).not.toHaveBeenCalled();
  });
  it("keeps available shared results on enqueue failure without claiming success", async () => {
    mocks.wake.mockRejectedValue(new Error("temporary outage"));
    expect(await readHostedGroupSharedDataWithFreshness(input)).toMatchObject({ freshness: { refreshStatus: "unavailable" } });
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });
  it("does not refresh arbitrary history or future days", async () => {
    for (const date of ["2026-07-01", "2026-08-20"]) {
      expect(await readHostedGroupSharedDataWithFreshness({ ...input, freshness: [{ ...freshness[0], date }] })).toMatchObject({ freshness: { refreshStatus: "unavailable" } });
    }
    expect(mocks.wake).not.toHaveBeenCalled();
  });
});
