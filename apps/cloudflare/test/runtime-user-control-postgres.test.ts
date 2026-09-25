import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedRuntimeOwnerSnapshot } from "@murphai/hosted-execution/runtime-owner";
import type { HostedExecutionContainerStubLike } from "../src/runner-container.ts";
import { controlPostgresRuntimeVoice, deletePostgresRunnerUserData, readPostgresRunnerStatus, reconcilePostgresRuntimeConsent, stopPostgresRuntimeForUser } from "../src/runtime-user-control.ts";
import { commandHostedRuntimeOwner } from "../src/runtime-owner-client.ts";
import { fetchHostedExecutionWebControlPlaneResponse } from "../src/web-control-plane.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import { hostedMediaObjectKey } from "../src/storage-paths.ts";
import { MemoryEncryptedR2Bucket } from "./test-helpers.ts";

vi.mock("../src/runtime-owner-client.ts", () => ({ commandHostedRuntimeOwner: vi.fn() }));
vi.mock("../src/web-control-plane.ts", () => ({ fetchHostedExecutionWebControlPlaneResponse: vi.fn() }));

class CleanupBucket extends MemoryEncryptedR2Bucket {
  async list(input: { prefix?: string; limit?: number }) {
    const keys = [...this.objects.keys()].filter(key => key.startsWith(input.prefix ?? "")).sort();
    const limit = input.limit ?? 1000;
    return { objects: keys.slice(0, limit).map(key => ({ key })), truncated: keys.length > limit };
  }
}

function harness() {
  const userId = "synthetic-control-member";
  const target = `runner--v-release_1--${"1".repeat(32)}`;
  const owner: HostedRuntimeOwnerSnapshot = { userId, attemptId: "synthetic-control-attempt", generation: "1",
    phase: "active", processingMode: "default", allocationId: "standby-claim-11111111-1111-4111-8111-111111111111",
    runnerContainerName: target, workspaceVersion: "0", customInferenceEnvelope: null, platformAiUsageAllowed: true,
    startedAt: "2026-09-15T00:00:00.000Z", acceptedAt: null, completedAt: null, failureCount: 0, lastErrorCode: null };
  const slot = { invoke: vi.fn(), smokeHealth: vi.fn(), destroyInstance: vi.fn(),
    controlVoice: vi.fn(async () => ({ kind: "closed" as const, providerConfirmed: true, seconds: 12 })),
    bindStandbySlot: vi.fn(), prepareStandbySlot: vi.fn(), resolveRetainedStandbySlot: vi.fn(),
    readStandbySlotCoordinatorState: vi.fn(), retireStandbySlot: vi.fn(async () => ({ retired: true as const })),
    readStandbySlotBinding: vi.fn(async () => ({ state: "retired" as const, slotName: target, claimId: null,
      userId: null, region: "GLOBAL" as const, releaseId: "release_1" })),
  } satisfies HostedExecutionContainerStubLike;
  const source = { ...createHostedExecutionTestEnv(), BUNDLES: new CleanupBucket(),
    RUNNER_CONTAINER: { getByName: vi.fn(() => slot) },
    USER_RUNNER: { getByName() { throw new Error("Unexpected UserRunner activation"); } } };
  vi.mocked(commandHostedRuntimeOwner).mockImplementation(async ({ command }) => ({ cutover: "postgres",
    status: command.operation === "reconcile" ? "observed" : command.operation === "deletion_ready" ? "blocked" : "updated",
    owner: command.operation === "reconcile" ? owner : null }));
  return { userId, target, owner, slot, source };
}

describe("Postgres runtime user controls", () => {
  it("rejects an older container without voice capability before media startup", async () => {
    const h = harness();
    const { controlVoice: _voice, ...oldContainer } = h.slot;
    const source = { ...h.source, RUNNER_CONTAINER: { getByName: () => oldContainer } };
    expect(await controlPostgresRuntimeVoice(source, h.userId, {
      action: "connect", callId: "call-synthetic", attemptId: h.owner.attemptId!,
      leaseGeneration: h.owner.generation, sdp: "v=0\r\noffer",
    })).toEqual({ kind: "unavailable" });
    expect(h.slot.invoke).not.toHaveBeenCalled();
  });
  it("routes voice to the persisted exact owner without invoking or allocating work", async () => {
    const h = harness();
    const request = { action: "close" as const, callId: "call-synthetic",
      attemptId: h.owner.attemptId!, leaseGeneration: h.owner.generation };
    expect(await controlPostgresRuntimeVoice(h.source, h.userId, request)).toMatchObject({ kind: "closed", providerConfirmed: true });
    expect(h.source.RUNNER_CONTAINER.getByName).toHaveBeenCalledExactlyOnceWith(h.target);
    expect(h.slot.controlVoice).toHaveBeenCalledExactlyOnceWith({ ...request, userId: h.userId });
    expect(h.slot.invoke).not.toHaveBeenCalled();
    expect(h.slot.bindStandbySlot).not.toHaveBeenCalled();
  });

  it.each([{ attemptId: "old-attempt" }, { leaseGeneration: "0" }])("rejects stale voice authority before container lookup", async (change) => {
    const h = harness();
    expect(await controlPostgresRuntimeVoice(h.source, h.userId, {
      action: "close", callId: "call-synthetic", attemptId: h.owner.attemptId!,
      leaseGeneration: h.owner.generation, ...change,
    })).toEqual({ kind: "unavailable" });
    expect(h.source.RUNNER_CONTAINER.getByName).not.toHaveBeenCalled();
  });

  it("permits close after usage revocation while denying another connection", async () => {
    const h = harness();
    h.owner.platformAiUsageAllowed = false;
    const request = { action: "connect" as const, callId: "call-synthetic", sdp: "v=0\r\noffer",
      attemptId: h.owner.attemptId!, leaseGeneration: h.owner.generation };
    expect(await controlPostgresRuntimeVoice(h.source, h.userId, request)).toEqual({ kind: "unavailable" });
    expect(h.slot.controlVoice).not.toHaveBeenCalled();
    expect(await controlPostgresRuntimeVoice(h.source, h.userId, { ...request, action: "close" })).toMatchObject({ kind: "closed" });
  });
  beforeEach(() => vi.clearAllMocks());

  it("reads Web status and owner state without activating UserRunner", async () => {
    const h = harness();
    vi.mocked(fetchHostedExecutionWebControlPlaneResponse).mockResolvedValue(Response.json({ userId: h.userId, workspace: null, mailboxLag: [] }));
    expect(await readPostgresRunnerStatus(h.source, h.userId)).toMatchObject({ userId: h.userId, inFlight: true, nextAlarmAt: null });
    expect(h.source.RUNNER_CONTAINER.getByName).not.toHaveBeenCalled();
  });

  it("revokes before exact target retirement and refuses an uncertain stop", async () => {
    const h = harness();
    h.slot.retireStandbySlot.mockImplementation(async () => {
      expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.at(-1)?.[0].command.operation).toBe("retire");
      throw new Error("synthetic uncertain stop");
    });
    await expect(stopPostgresRuntimeForUser(h.source, h.userId, h.owner)).rejects.toThrow("synthetic uncertain stop");
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([input]) => input.command.operation)).toEqual(["retire"]);
  });

  it("stops the exact revoked-consent target before acknowledging reconciliation", async () => {
    const h = harness();
    vi.mocked(fetchHostedExecutionWebControlPlaneResponse).mockResolvedValue(Response.json({ userId: h.userId, processingAllowed: false, consentState: "revoked" }));
    expect(await reconcilePostgresRuntimeConsent(h.source, h.userId)).toMatchObject({ processingAllowed: false, activeInvocationPreempted: true, runnerContainerDestroyOk: true });
    expect(h.slot.retireStandbySlot).toHaveBeenCalledWith({ claimId: h.owner.allocationId, target: { slotName: h.target, userId: h.userId } });
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([input]) => input.command.operation)).toEqual(["reconcile", "retire", "target_retired"]);
  });

  it("confirms R2 cleanup without falsely reporting legacy Durable Object deletion", async () => {
    const h = harness();
    vi.mocked(commandHostedRuntimeOwner).mockImplementation(async ({ command }) => ({ cutover: "postgres",
      status: command.operation === "deletion_ready" ? "authorized" : "observed", owner: null }));
    const key = await hostedMediaObjectKey({ userId: h.userId, mediaId: "a".repeat(64) });
    await h.source.BUNDLES.put(key, "synthetic-ciphertext");
    expect(await deletePostgresRunnerUserData(h.source, h.userId)).toMatchObject({ ok: true,
      stateOwner: "postgres", runtimeStateCleared: true, r2: { deletedObjectCount: 1 },
      durableObject: { stateDeleted: false, deleteAllCompleted: false, alarmCleared: false } });
    expect(await h.source.BUNDLES.get(key)).toBeNull();
  });

  it("preserves R2 data when independent uploads have not drained", async () => {
    const h = harness();
    const remove = vi.spyOn(h.source.BUNDLES, "delete");
    expect(await deletePostgresRunnerUserData(h.source, h.userId)).toMatchObject({ ok: false, reason: "r2_upload_drain_pending" });
    expect(remove).not.toHaveBeenCalled();
  });
});
