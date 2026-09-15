import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedRuntimeOwnerSnapshot } from "@murphai/hosted-execution/runtime-owner";
import type { HostedExecutionContainerStubLike } from "../src/runner-container.ts";
import { deletePostgresRunnerUserData, readPostgresRunnerStatus, reconcilePostgresRuntimeConsent, stopPostgresRuntimeForUser } from "../src/runtime-user-control.ts";
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
