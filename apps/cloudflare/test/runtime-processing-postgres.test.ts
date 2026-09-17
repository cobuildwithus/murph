import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedRuntimeOwnerResponse, HostedRuntimeOwnerSnapshot } from "@murphai/hosted-execution/runtime-owner";
import { ensurePostgresRuntimeProcessing } from "../src/runtime-processing.ts";
import { commandHostedRuntimeMigration } from "../src/runtime-migration-client.ts";
import { commandHostedRuntimeOwner } from "../src/runtime-owner-client.ts";
import { recordHostedRuntimeOwnerCompletion } from "../src/runtime-owner-completion.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import { MemoryEncryptedR2Bucket } from "./test-helpers.ts";
import type { HostedExecutionContainerStubLike, HostedExecutionContainerInvokeRequest } from "../src/runner-container.ts";
import type { RunnerWriteFenceToken } from "../src/user-runner/runner-state-store.ts";
import type { HostedStandbySlotBinding } from "../src/standby-runner-contract.ts";
import type { RunnerInvocationReceipt } from "../src/runner-invocation-receipt.ts";
import type { RuntimeInvocationPreparation } from "../src/runtime-invocation-preparation.ts";

vi.mock("../src/runtime-migration-client.ts", () => ({ commandHostedRuntimeMigration: vi.fn() }));
vi.mock("../src/runtime-owner-client.ts", () => ({ commandHostedRuntimeOwner: vi.fn() }));
vi.mock("../src/runtime-owner-completion.ts", () => ({ recordHostedRuntimeOwnerCompletion: vi.fn(async () => true) }));
vi.mock("../src/runtime-invocation-preparation.ts", () => ({
  RuntimeInvocationPreparation: class {
    constructor(private readonly input: ConstructorParameters<typeof RuntimeInvocationPreparation>[0]) {}
    prepareForFreshStart() {
      return async (token: RunnerWriteFenceToken) => {
        const bound = await this.input.bindInvocation({ token, workspaceVersion: "0", customInferenceEnvelope: null, platformAiUsageAllowed: true });
        return { customInferenceEnvelope: null, platformAiUsageAllowed: true, job: { request: { providerEgressToken: bound.providerEgressToken } }, token: bound, input: {}, workspaceVersion: "0", workspaceCheckpointedAt: null };
      };
    }
  },
}));

const target = `runner--v-release_1--${"1".repeat(32)}`;
const allocationId = "standby-claim-11111111-1111-4111-8111-111111111111";
const request = { userId: "member-a", orchestrationAttemptId: "orchestration-a" };
function owner(patch: Partial<HostedRuntimeOwnerSnapshot> = {}): HostedRuntimeOwnerSnapshot {
  return { userId: request.userId, attemptId: "attempt-a", generation: "1", phase: "active",
    processingMode: "default", allocationId, runnerContainerName: target, workspaceVersion: "0",
    customInferenceEnvelope: null, platformAiUsageAllowed: true, startedAt: new Date().toISOString(),
    acceptedAt: null, completedAt: null, failureCount: 0, lastErrorCode: null, ...patch };
}
function response(current: HostedRuntimeOwnerSnapshot | null, status: HostedRuntimeOwnerResponse["status"] = "existing"): HostedRuntimeOwnerResponse {
  return { cutover: "postgres", status, owner: current };
}
function harness() {
  const binding = { state: "bound" as const, slotName: target, releaseId: "release_1", region: "GLOBAL" as const, userId: request.userId, claimId: allocationId };
  const container = {
    destroyInstance: vi.fn(async () => {}), invoke: vi.fn(), smokeHealth: vi.fn(),
    readSupervisedInvocation: vi.fn(async (): Promise<RunnerInvocationReceipt | null> => null),
    readActiveRuntimeUserFence: vi.fn(async () => ({ active: false as const, reason: "no_active_runtime" as const })),
    ensureProcessing: vi.fn(async () => ({ kind: "accepted" as const, action: "woken" as const })),
    ensureReadyForProcessing: vi.fn(async (): Promise<import("../src/runner-container.ts").RunnerContainerEnsureReadyForProcessingResult> => ({ kind: "ready", preparesSupervisedLaunch: true })),
    startSupervisedInvocation: vi.fn(async (_input: HostedExecutionContainerInvokeRequest) => ({ accepted: true as const })),
    bindStandbySlot: vi.fn(async (input) => ({ ...input, bound: true as const })),
    prepareStandbySlot: vi.fn(),
    readStandbySlotBinding: vi.fn(async (): Promise<HostedStandbySlotBinding> => binding),
    readStandbySlotCoordinatorState: vi.fn(async () => ({ coordinatorOwned: false, releaseId: binding.releaseId, slotName: target, state: binding.state })),
    resolveRetainedStandbySlot: vi.fn(async () => binding),
    retireStandbySlot: vi.fn(async () => ({ retired: true as const })),
  } satisfies HostedExecutionContainerStubLike;
  const unused = async (): Promise<never> => { throw new Error("Unexpected legacy runtime operation."); };
  const source = { USER_RUNNER: { getByName: () => ({ bindUser: unused, deleteHostedUserData: unused,
    publishHostedPrivateMedia: unused, ensureRuntimeProcessingForUser: unused, runnerStatus: unused }) }, ...createHostedExecutionTestEnv(), CF_VERSION_METADATA: { id: "release_1" },
    HOSTED_RUNTIME_POSTGRES_ENABLED: "true", BUNDLES: new MemoryEncryptedR2Bucket(), RUNNER_CONTAINER: { getByName: () => container } };
  return { source, container, binding };
}

describe("Postgres runtime orchestration", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(commandHostedRuntimeMigration).mockResolvedValue({ gate: { phase: "legacy" } });
  });

  it("returns a retry at command expiry without retiring or launching the uncertain owner", async () => {
    vi.useFakeTimers();
    const { source, container } = harness();
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValueOnce(response(owner({ phase: "starting" }), "claimed"))
      .mockResolvedValue(response(owner({ phase: "starting" }), "updated"));
    let ready!: (value: { kind: "ready" }) => void;
    container.ensureReadyForProcessing.mockImplementation(() => new Promise(resolve => { ready = resolve; }));
    const result = ensurePostgresRuntimeProcessing(source, { ...request, commandTimeoutMs: 2_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toMatchObject({ kind: "retry_later" });
    ready({ kind: "ready" });
    await vi.advanceTimersByTimeAsync(0);
    expect(container.startSupervisedInvocation).not.toHaveBeenCalled();
    expect(container.retireStandbySlot).not.toHaveBeenCalled();
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([input]) => input.command.operation))
      .not.toContain("release");
  });

  it.each([true, false])("retains an ambiguously accepted launch after execution timeout (launch preparation: %s)", async (supported) => {
    const { source, container } = harness();
    container.ensureReadyForProcessing.mockResolvedValue({ kind: "ready", ...(supported ? { preparesSupervisedLaunch: true } : {}) });
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValueOnce(response(owner({ phase: "starting" }), "claimed"))
      .mockResolvedValue(response(owner({ phase: "starting" }), "updated"));
    container.startSupervisedInvocation.mockRejectedValue(new DOMException("Synthetic timeout", "TimeoutError"));
    expect(await ensurePostgresRuntimeProcessing(source, request)).toMatchObject({ kind: "retry_later" });
    expect(container.startSupervisedInvocation).toHaveBeenCalledOnce();
    expect(container.retireStandbySlot).not.toHaveBeenCalled();
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([input]) => input.command.operation))
      .toEqual(supported ? ["claim"] : ["claim", "prepare_launch"]);
    // The next command observes that exact live owner rather than launching again.
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue(response(owner()));
    expect(await ensurePostgresRuntimeProcessing(source, request)).toMatchObject({ kind: "runtime_processing_accepted", action: "woken" });
    expect(container.startSupervisedInvocation).toHaveBeenCalledOnce();
  });

  it.each([true, false])("starts with container launch preparation capability %s", async (supported) => {
    const { source, container } = harness();
    container.ensureReadyForProcessing.mockResolvedValue({ kind: "ready", ...(supported ? { preparesSupervisedLaunch: true } : {}) });
    vi.mocked(commandHostedRuntimeOwner).mockImplementation(async ({ command }) =>
      response(owner({ phase: "starting" }), command.operation === "claim" ? "claimed" : "updated"));
    expect(await ensurePostgresRuntimeProcessing(source, request)).toMatchObject({ action: "started" });
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([input]) => input.command.operation))
      .toEqual(supported ? ["claim", "accepted"] : ["claim", "prepare_launch", "accepted"]);
    const payload = container.startSupervisedInvocation.mock.calls[0]?.[0];
    expect(Boolean(payload?.launch)).toBe(supported);
  });

  it("completes a new member's exact empty handoff through processing retries without an operator", async () => {
    const { source, container } = harness();
    const objectId = "a".repeat(64);
    let section = 0; let activated = false;
    const legacy = {
      inspectPostgresMigration: vi.fn(async () => ({ kind: "observed" as const, schemaVersion: null,
        userId: null, generation: "0", activeAttemptId: null, activeRunnerContainerName: null,
        workspaceVersion: null, snapshotPutDrainUntil: null, replicaPendingWrites: 0,
        replicaRecoveryDrainUntil: null, managedSnapshotPendingUploads: 0, observedAt: "2026-09-16T00:00:00.000Z",
        freeze: { phase: null, pendingOperations: 0 } })),
      freezeEmptyForPostgresMigration: vi.fn(async () => ({ frozen: true })),
      exportPostgresMigrationPage: vi.fn(async () => ({ schema: "murph.legacy-runtime-export.v1" as const,
        userId: null, generation: "0", cursor: { section, after: "" },
        next: section < 3 ? { section: section + 1, after: "" } : null, records: [], hash: "b".repeat(64) })),
      bindUser: vi.fn(), deleteHostedUserData: vi.fn(), publishHostedPrivateMedia: vi.fn(),
      ensureRuntimeProcessingForUser: vi.fn(), runnerStatus: vi.fn(),
    };
    const namespace = { idFromName: vi.fn(() => ({ toString: () => objectId })),
      idFromString: vi.fn(() => ({ toString: () => objectId })), get: vi.fn(() => legacy), getByName: vi.fn(() => legacy) };
    vi.mocked(commandHostedRuntimeMigration).mockImplementation(async ({ command }) => {
      if (command.operation === "status") return { gate: { phase: "rolling", namespaceId: "synthetic_namespace",
        workerVersion: "release_1", namespaceProbeId: objectId, creationClosedAt: "synthetic-closed", inventorySealedAt: "synthetic-sealed" } };
      if (command.operation === "enroll_sources") return { enrolled: 1 };
      if (command.operation === "select_first_use") return { objectId };
      if (command.operation === "read_object") return { object: { completedAt: section === 4 ? "synthetic-complete" : null, nextCursor: { section, after: "" } } };
      if (command.operation === "import_empty") { section++; return { object: { completedAt: section === 4 ? "synthetic-complete" : null } }; }
      if (command.operation === "activate_empty") { expect(section).toBe(4); activated = true; return { done: true }; }
      throw new Error("Unexpected first-use migration command.");
    });
    vi.mocked(commandHostedRuntimeOwner).mockImplementation(async ({ command }) => {
      if (!activated) return { cutover: "draining", status: "blocked", owner: null };
      return response(owner({ phase: "starting", workspaceVersion: null }), command.operation === "claim" ? "claimed" : "updated");
    });
    for (let attempt = 0; attempt < 5; attempt++) {
      expect(await ensurePostgresRuntimeProcessing({ ...source, USER_RUNNER: namespace }, request)).toMatchObject({ kind: "retry_later" });
      expect(container.startSupervisedInvocation).not.toHaveBeenCalled();
    }
    expect(activated).toBe(true);
    expect(namespace.idFromName).toHaveBeenCalledWith(request.userId);
    expect(namespace.getByName).not.toHaveBeenCalled();
    expect(legacy.ensureRuntimeProcessingForUser).not.toHaveBeenCalled();
    expect(await ensurePostgresRuntimeProcessing({ ...source, USER_RUNNER: namespace }, request)).toMatchObject({ kind: "runtime_processing_accepted", action: "started" });
    expect(container.startSupervisedInvocation).toHaveBeenCalledOnce();
  });

  it("uses the finite legacy bridge and closes admission during draining", async () => {
    const { source, container } = harness();
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValueOnce({ cutover: "legacy", status: "blocked", owner: null });
    expect(await ensurePostgresRuntimeProcessing({ ...source, HOSTED_RUNTIME_POSTGRES_ENABLED: "false" }, request)).toBeNull();
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValueOnce({ cutover: "draining", status: "blocked", owner: null });
    expect(await ensurePostgresRuntimeProcessing(source, request)).toMatchObject({ kind: "retry_later" });
    expect(container.startSupervisedInvocation).not.toHaveBeenCalled();
  });

  it("keeps legacy processing available when the mixed-capable deployment is enabled", async () => {
    const { source, container } = harness();
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue({ cutover: "legacy", status: "blocked", owner: null });
    expect(await ensurePostgresRuntimeProcessing(source, request)).toBeNull();
    expect(container.startSupervisedInvocation).not.toHaveBeenCalled();
    expect(container.retireStandbySlot).not.toHaveBeenCalled();
  });

  it("does not fall back to legacy for a migrated member on a disabled deployment", async () => {
    const { source, container } = harness();
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue(response(owner(), "observed"));
    expect(await ensurePostgresRuntimeProcessing({ ...source, HOSTED_RUNTIME_POSTGRES_ENABLED: "false" }, request)).toMatchObject({ kind: "retry_later" });
    expect(container.startSupervisedInvocation).not.toHaveBeenCalled();
  });

  it("wakes the exact live owner and forwards foreground promotion in place", async () => {
    const { source, container } = harness();
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue(response(owner({ processingMode: "system_mailbox" })));
    expect(await ensurePostgresRuntimeProcessing(source, request)).toMatchObject({ kind: "runtime_processing_accepted", action: "woken", runtimeAttemptId: "attempt-a" });
    expect(container.ensureProcessing).toHaveBeenCalledWith(expect.objectContaining({ activeRuntime: expect.objectContaining({ attemptId: "attempt-a", leaseGeneration: "1", requestedProcessingMode: "default" }) }));
    expect(container.startSupervisedInvocation).not.toHaveBeenCalled();
  });

  it("does not discard authority when a wake acknowledgement is unknown", async () => {
    const { source, container } = harness();
    container.ensureProcessing.mockRejectedValue(new Error("synthetic lost acknowledgment"));
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue(response(owner()));
    expect(await ensurePostgresRuntimeProcessing(source, request)).toMatchObject({ kind: "retry_later" });
    expect(commandHostedRuntimeOwner).toHaveBeenCalledTimes(1);
    expect(container.retireStandbySlot).not.toHaveBeenCalled();
  });

  it("fences an expired unacknowledged launch through exact native retirement before releasing it", async () => {
    const { source, container, binding } = harness();
    // The original bind might never have initialized its reserved target.
    container.readSupervisedInvocation.mockRejectedValue(new Error("synthetic uninitialized slot"));
    container.readStandbySlotBinding.mockResolvedValue({ ...binding, state: "retired", claimId: null, userId: null });
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValueOnce(response(owner({ phase: "starting", workspaceVersion: null, startedAt: "2020-01-01T00:00:00Z" })))
      .mockResolvedValue(response(null, "updated"));
    await ensurePostgresRuntimeProcessing(source, request);
    expect(container.retireStandbySlot).toHaveBeenCalledWith({ claimId: allocationId, target: { slotName: target, userId: request.userId } });
    const operations = vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([input]) => input.command.operation);
    expect(operations).toEqual(["claim", "retire", "release"]);
    expect(container.startSupervisedInvocation).not.toHaveBeenCalled();
  });

  it("keeps an uncertain native stop pinned", async () => {
    const { source, container } = harness();
    container.retireStandbySlot.mockRejectedValue(new Error("synthetic stop uncertainty"));
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValueOnce(response(owner({ phase: "retiring" }))).mockResolvedValue(response(null, "updated"));
    await expect(ensurePostgresRuntimeProcessing(source, request)).rejects.toThrow("stop uncertainty");
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([input]) => input.command.operation)).toEqual(["claim", "retire"]);
  });

  it("reconciles a lost completion acknowledgment and starts the successor in the retained warm shell", async () => {
    const { source, container } = harness();
    container.readSupervisedInvocation.mockResolvedValue({ attemptId: "attempt-a", generation: "1", state: "completed", immediateRecheckRequested: true });
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValueOnce(response(owner()))
      .mockResolvedValueOnce(response(null, "updated"))
      .mockResolvedValueOnce(response(owner({ attemptId: "attempt-b", generation: "2", phase: "starting", workspaceVersion: null }), "claimed"))
      .mockResolvedValue(response(owner({ attemptId: "attempt-b", generation: "2" }), "updated"));
    expect(await ensurePostgresRuntimeProcessing(source, request)).toMatchObject({ kind: "runtime_processing_accepted", runtimeAttemptId: "attempt-b" });
    expect(recordHostedRuntimeOwnerCompletion).toHaveBeenCalledWith(expect.objectContaining({ attemptId: "attempt-a", result: { immediateRecheckRequested: true } }));
    expect(container.resolveRetainedStandbySlot).toHaveBeenCalled();
    expect(container.bindStandbySlot).not.toHaveBeenCalled();
    expect(container.retireStandbySlot).not.toHaveBeenCalled();
    expect(container.startSupervisedInvocation).toHaveBeenCalledTimes(1);
    const token = container.startSupervisedInvocation.mock.calls[0]?.[0]?.job.request.providerEgressToken;
    expect(token).toMatch(/^provider-egress-[a-f0-9]{64}$/u);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token!)));
    const hash = Array.from(digest, value => value.toString(16).padStart(2, "0")).join("");
    expect(container.startSupervisedInvocation).toHaveBeenCalledWith(expect.objectContaining({
      launch: expect.objectContaining({ providerEgressTokenHash: hash }),
    }));
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([input]) => input.command.operation))
      .toEqual(["claim", "release_completed", "claim", "accepted"]);
    expect(JSON.stringify(vi.mocked(commandHostedRuntimeOwner).mock.calls)).not.toContain(token);
  });
});
