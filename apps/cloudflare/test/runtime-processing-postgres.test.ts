import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeProcessingDiagnostics } from "../src/user-runner/diagnostics.ts";
import type { HostedRuntimeOwnerResponse, HostedRuntimeOwnerSnapshot } from "@murphai/hosted-execution/runtime-owner";
import { ensurePostgresRuntimeProcessing } from "../src/runtime-processing.ts";
import { commandHostedRuntimeOwner } from "../src/runtime-owner-client.ts";
import { recordHostedRuntimeOwnerCompletion } from "../src/runtime-owner-completion.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import { MemoryEncryptedR2Bucket } from "./test-helpers.ts";
import type { HostedExecutionContainerStubLike, HostedExecutionContainerInvokeRequest } from "../src/runner-container.ts";
import type { RunnerWriteFenceToken } from "../src/runtime-invocation-token.ts";
import type { HostedStandbySlotBinding } from "../src/standby-runner-contract.ts";
import type { RunnerInvocationReceipt } from "../src/runner-invocation-receipt.ts";
import type { RuntimeInvocationPreparation } from "../src/runtime-invocation-preparation.ts";
import type { WorkerActiveRuntimeUserFenceResult } from "../src/worker-contracts.ts";

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
    readActiveRuntimeUserFence: vi.fn(async (): Promise<WorkerActiveRuntimeUserFenceResult> => ({ active: false, reason: "no_active_runtime" })),
    ensureProcessing: vi.fn(async (): Promise<import("../src/runner-container.ts").RunnerContainerEnsureProcessingResult> => ({ kind: "accepted", action: "woken" })),
    ensureWarmForBackgroundProcessing: vi.fn(async (): Promise<import("../src/runner-container.ts").RunnerContainerEnsureReadyForProcessingResult> => ({ kind: "ready", preparesSupervisedLaunch: true })),
    ensureReadyForProcessing: vi.fn(async (): Promise<import("../src/runner-container.ts").RunnerContainerEnsureReadyForProcessingResult> => ({ kind: "ready", preparesSupervisedLaunch: true })),
    startSupervisedInvocation: vi.fn(async (_input: HostedExecutionContainerInvokeRequest) => ({ accepted: true as const })),
    bindStandbySlot: vi.fn(async (input) => ({ ...input, bound: true as const })),
    prepareStandbySlot: vi.fn(),
    readStandbySlotBinding: vi.fn(async (): Promise<HostedStandbySlotBinding> => binding),
    readStandbySlotCoordinatorState: vi.fn(async () => ({ coordinatorOwned: false, releaseId: binding.releaseId, slotName: target, state: binding.state })),
    resolveRetainedStandbySlot: vi.fn(async (): Promise<HostedStandbySlotBinding> => binding),
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
  });

  it.each(["no_ready_slot", "disabled", "stale_release", "deadline_expired", "unavailable", "timeout"] as const)(
    "releases empty background admission without a cold start on %s", async outcome => {
      vi.useFakeTimers();
      const { source, container } = harness();
      const starting = owner({ phase: "starting", processingMode: "system_mailbox", runnerContainerName: null, workspaceVersion: null });
      vi.mocked(commandHostedRuntimeOwner).mockImplementation(async ({ command }) =>
        response(command.operation === "claim" ? starting : null, command.operation === "claim" ? "claimed" : "updated"));
      let finish!: (result: { outcome: "claimed"; slotName: string }) => void;
      const claimReadyStandby = vi.fn(async () => {
        if (outcome === "timeout") return new Promise<{ outcome: "claimed"; slotName: string }>(resolve => { finish = resolve; });
        if (outcome === "unavailable") throw new Error("Coordinator unavailable.");
        return { outcome };
      });
      const backgroundSource = { ...source, HOSTED_EXECUTION_STANDBY_MODE: "allocate", STANDBY_COORDINATOR: { getByName: () => ({
        claimReadyStandby, ensureReadyStandby: vi.fn(),
      }) } };
      const diagnostics: RuntimeProcessingDiagnostics = { stage: "admission", details: {} };
      const result = ensurePostgresRuntimeProcessing(backgroundSource, { ...request, processingMode: "system_mailbox" }, diagnostics);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await result).toMatchObject({ kind: "retry_later" });
      expect(diagnostics.details.runtimeProcessingRetryReason).toBe("background_standby_deferred");
      expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([call]) => call.command.operation)).toEqual(["claim", "retire", "release"]);
      if (outcome === "timeout") {
        finish({ outcome: "claimed", slotName: target });
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(container.bindStandbySlot).not.toHaveBeenCalled();
      expect(container.ensureReadyForProcessing).not.toHaveBeenCalled();
      expect(container.startSupervisedInvocation).not.toHaveBeenCalled();
      expect(commandHostedRuntimeOwner).toHaveBeenCalledTimes(3);
    });

  it("uses an existing ready target for fresh background execution", async () => {
    const { source, container } = harness();
    const starting = owner({ phase: "starting", processingMode: "system_mailbox", runnerContainerName: null, workspaceVersion: null });
    vi.mocked(commandHostedRuntimeOwner).mockImplementation(async ({ command }) => command.operation === "claim"
      ? response(starting, "claimed") : response({ ...starting, runnerContainerName: target }, "updated"));
    const claimReadyStandby = vi.fn(async () => ({ outcome: "claimed" as const, slotName: target }));
    const result = await ensurePostgresRuntimeProcessing({ ...source, HOSTED_EXECUTION_STANDBY_MODE: "allocate",
      STANDBY_COORDINATOR: { getByName: () => ({ claimReadyStandby, ensureReadyStandby: vi.fn() }) },
    }, { ...request, processingMode: "system_mailbox" });
    expect(result).toMatchObject({ kind: "runtime_processing_accepted", action: "started" });
    expect(claimReadyStandby).toHaveBeenCalledWith(expect.objectContaining({ claimId: allocationId }));
    expect(container.bindStandbySlot).toHaveBeenCalledWith(expect.objectContaining({ claimId: allocationId, slotName: target }));
    expect(container.ensureWarmForBackgroundProcessing).toHaveBeenCalledOnce();
    expect(container.ensureReadyForProcessing).not.toHaveBeenCalled();
    expect(container.startSupervisedInvocation).toHaveBeenCalledOnce();
  });

  it.each(["not_warm", "cleanup_unsettled", "old_controller"] as const)("retires a background target safely when readiness is %s", async kind => {
    const { source, container, binding } = harness();
    const starting = owner({ phase: "starting", processingMode: "system_mailbox", workspaceVersion: null });
    if (kind === "old_controller") Reflect.deleteProperty(container, "ensureWarmForBackgroundProcessing");
    else container.ensureWarmForBackgroundProcessing.mockResolvedValue({ kind });
    container.readStandbySlotBinding.mockResolvedValue({ ...binding, state: "retired", claimId: null, userId: null });
    vi.mocked(commandHostedRuntimeOwner).mockImplementation(async ({ command }) =>
      response(command.operation === "claim" ? starting : null, command.operation === "claim" ? "claimed" : "updated"));
    expect(await ensurePostgresRuntimeProcessing(source, { ...request, processingMode: "system_mailbox" })).toMatchObject({ kind: "retry_later" });
    expect(container.retireStandbySlot).toHaveBeenCalledOnce();
    expect(container.startSupervisedInvocation).not.toHaveBeenCalled();
    expect(container.ensureReadyForProcessing).not.toHaveBeenCalled();
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([call]) => call.command.operation)).toEqual(["claim", "retire", "release"]);
  });

  it.each(["timeout", "old_rpc"] as const)("releases background preparation after %s without workspace I/O or launch", async failure => {
    vi.useFakeTimers();
    const { source, container, binding } = harness();
    const starting = owner({ phase: "starting", processingMode: "system_mailbox", workspaceVersion: null });
    container.ensureWarmForBackgroundProcessing.mockImplementation(async () => {
      if (failure === "old_rpc") throw new Error("RPC method not found.");
      return new Promise(() => {});
    });
    container.readStandbySlotBinding.mockResolvedValue({ ...binding, state: "retired", claimId: null, userId: null });
    vi.mocked(commandHostedRuntimeOwner).mockImplementation(async ({ command }) =>
      response(command.operation === "claim" ? starting : null, command.operation === "claim" ? "claimed" : "updated"));
    const began = Date.now();
    const result = ensurePostgresRuntimeProcessing(source, { ...request, processingMode: "system_mailbox" });
    await vi.advanceTimersByTimeAsync(3_000);
    const outcome = await result;
    expect(outcome.kind).toBe("retry_later");
    if (outcome.kind !== "retry_later") throw new Error("Expected capacity deferral.");
    expect(Date.parse(outcome.retryAt) - began).toBeGreaterThanOrEqual(15_000);
    expect(Date.parse(outcome.retryAt) - began).toBeLessThanOrEqual(33_000);
    expect(container.startSupervisedInvocation).not.toHaveBeenCalled();
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([call]) => call.command.operation)).toEqual(["claim", "retire", "release"]);
  });

  it.each(["timeout", "throw", "uncertain_stop"] as const)("retires a newly selected background target exactly once after %s", async failure => {
    vi.useFakeTimers();
    const { source, container, binding } = harness();
    let current = owner({ phase: "starting", processingMode: "system_mailbox", runnerContainerName: null, workspaceVersion: null });
    vi.mocked(commandHostedRuntimeOwner).mockImplementation(async ({ command }) => {
      if (command.operation === "select_target") current = { ...current, runnerContainerName: command.runnerContainerName };
      return response(current, command.operation === "claim" ? "claimed" : "updated");
    });
    container.readStandbySlotBinding.mockResolvedValue({ ...binding, state: "retired", claimId: null, userId: null });
    container.ensureWarmForBackgroundProcessing.mockImplementation(async () => {
      if (failure === "timeout") return new Promise(() => {});
      if (failure === "throw") throw new Error("Readiness unavailable.");
      return { kind: "not_warm" };
    });
    if (failure === "uncertain_stop") container.retireStandbySlot.mockRejectedValue(new Error("Stop uncertain."));
    const shared = { ...source, HOSTED_EXECUTION_STANDBY_MODE: "allocate", STANDBY_COORDINATOR: { getByName: () => ({
      claimReadyStandby: vi.fn(async () => ({ outcome: "claimed" as const, slotName: target })), ensureReadyStandby: vi.fn(),
    }) } };
    const result = ensurePostgresRuntimeProcessing(shared, { ...request, processingMode: "system_mailbox" });
    const checked = failure === "uncertain_stop" ? expect(result).rejects.toThrow("Stop uncertain.")
      : expect(result).resolves.toMatchObject({ kind: "retry_later" });
    await vi.advanceTimersByTimeAsync(3_000);
    await checked;
    expect(container.retireStandbySlot).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ target: { slotName: target, userId: request.userId } }));
    const commands = vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([call]) => call.command);
    expect(commands.filter(command => command.operation === "retire")).toHaveLength(1);
    if (failure === "uncertain_stop") expect(commands.filter(command => command.operation === "release")).toHaveLength(0);
    else expect(commands).toContainEqual(expect.objectContaining({ operation: "release", runnerContainerName: target }));
    expect(container.startSupervisedInvocation).not.toHaveBeenCalled();
  });

  it("leaves foreground admission available throughout a slow empty-pool refill", async () => {
    const { source, container } = harness();
    let current: HostedRuntimeOwnerSnapshot | null = null;
    vi.mocked(commandHostedRuntimeOwner).mockImplementation(async ({ command }) => {
      if (command.operation === "claim") {
        if (current) return response(current);
        current = owner({ phase: "starting", workspaceVersion: null, processingMode: command.processingMode,
          runnerContainerName: command.processingMode === "system_mailbox" ? null : target });
        return response(current, "claimed");
      }
      if (command.operation === "release") current = null;
      return response(current, "updated");
    });
    const claimReadyStandby = vi.fn(async () => ({ outcome: "no_ready_slot" as const }));
    const pool = { claimReadyStandby, ensureReadyStandby: vi.fn() };
    const shared = { ...source, HOSTED_EXECUTION_STANDBY_MODE: "allocate", STANDBY_COORDINATOR: { getByName: () => pool } };
    for (let retry = 0; retry < 10; retry += 1) {
      expect(await ensurePostgresRuntimeProcessing(shared, { ...request, processingMode: "system_mailbox" })).toMatchObject({ kind: "retry_later" });
      expect(current).toBeNull();
    }
    expect(await ensurePostgresRuntimeProcessing(shared, request)).toMatchObject({ kind: "runtime_processing_accepted" });
    expect(container.startSupervisedInvocation).toHaveBeenCalledOnce();
    expect(await ensurePostgresRuntimeProcessing(shared, { ...request, processingMode: "system_mailbox" })).toMatchObject({ kind: "retry_later" });
    expect(claimReadyStandby).toHaveBeenCalledTimes(10);
  });

  it("admits a concurrent foreground message after a background pool timeout without waiting for cold refill", async () => {
    vi.useFakeTimers();
    const { source, container } = harness();
    const began = Date.now();
    let current: HostedRuntimeOwnerSnapshot | null = null;
    vi.mocked(commandHostedRuntimeOwner).mockImplementation(async ({ command }) => {
      if (command.operation === "claim") {
        if (current) return response(current);
        current = owner({ phase: "starting", workspaceVersion: null, processingMode: command.processingMode,
          runnerContainerName: command.processingMode === "system_mailbox" ? null : target });
        return response(current, "claimed");
      }
      if (command.operation === "release") current = null;
      return response(current, "updated");
    });
    let finish!: (result: { outcome: "claimed"; slotName: string }) => void;
    const claimReadyStandby = vi.fn(() => new Promise<{ outcome: "claimed"; slotName: string }>(resolve => { finish = resolve; }));
    const shared = { ...source, HOSTED_EXECUTION_STANDBY_MODE: "allocate",
      STANDBY_COORDINATOR: { getByName: () => ({ claimReadyStandby, ensureReadyStandby: vi.fn() }) } };
    const background = ensurePostgresRuntimeProcessing(shared, { ...request, processingMode: "system_mailbox" });
    await vi.advanceTimersByTimeAsync(0);
    expect(claimReadyStandby).toHaveBeenCalledOnce();
    expect(await ensurePostgresRuntimeProcessing(shared, request)).toMatchObject({
      kind: "retry_later", retryAt: new Date(began + 1_000).toISOString(),
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await background).toMatchObject({ kind: "retry_later" });
    expect(current).toBeNull();
    expect(container.ensureWarmForBackgroundProcessing).not.toHaveBeenCalled();
    expect(await ensurePostgresRuntimeProcessing(shared, request)).toMatchObject({ kind: "runtime_processing_accepted" });
    finish({ outcome: "claimed", slotName: target });
    await vi.advanceTimersByTimeAsync(0);
    expect(container.startSupervisedInvocation).toHaveBeenCalledOnce();
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.filter(([call]) => call.command.operation === "select_target")).toHaveLength(0);
  });

  it.each(["claimed", "existing"] as const)("continues from completed background ownership to a %s successor without a retry", async status => {
    const { source, container } = harness();
    const completed = owner({ processingMode: "system_mailbox", phase: "retiring", completedAt: new Date().toISOString() });
    const successor = owner({ attemptId: "attempt-b", generation: "2", phase: status === "claimed" ? "starting" : "active" });
    container.readSupervisedInvocation.mockResolvedValue({ attemptId: "attempt-a", generation: "1", state: "completed", immediateRecheckRequested: false });
    // Another completion caller may already have released the old generation.
    vi.mocked(recordHostedRuntimeOwnerCompletion).mockResolvedValueOnce(false);
    vi.mocked(commandHostedRuntimeOwner)
      .mockResolvedValueOnce(response(completed))
      .mockImplementation(async ({ command }) => command.operation === "claim"
        ? response(successor, status) : response(null, command.operation === "release_completed" ? "stale" : "updated"));
    expect(await ensurePostgresRuntimeProcessing(source, request)).toMatchObject({
      kind: "runtime_processing_accepted", runtimeAttemptId: "attempt-b",
      action: status === "claimed" ? "started" : "woken",
    });
    expect(recordHostedRuntimeOwnerCompletion).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: "attempt-a", generation: "1", settledRunnerContainerName: target,
    }));
    expect(container.startSupervisedInvocation).toHaveBeenCalledTimes(status === "claimed" ? 1 : 0);
    expect(container.retireStandbySlot).not.toHaveBeenCalled();
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([input]) => input.command.operation)).not.toContain("release_completed");
  });

  it("uses the command budget for native readiness while preserving the Web callback timeout", async () => {
    vi.useFakeTimers();
    const { source, container } = harness();
    const starting = owner({ phase: "starting" });
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue(response(starting, "updated"));
    container.ensureReadyForProcessing.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 12_000));
      return { kind: "ready", preparesSupervisedLaunch: true };
    });
    const result = ensurePostgresRuntimeProcessing({ ...source, HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS: "10000" }, { ...request, admission: response(starting, "claimed") });
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await result).toMatchObject({ kind: "runtime_processing_accepted", action: "started" });
    expect(container.startSupervisedInvocation).toHaveBeenCalledOnce();
    expect(commandHostedRuntimeOwner).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 7_000 }));
  });

  it("bounds a Web callback independently of the longer command budget", async () => {
    vi.useFakeTimers();
    const { source, container } = harness();
    vi.mocked(commandHostedRuntimeOwner).mockImplementation(() => new Promise(() => {}));
    const result = ensurePostgresRuntimeProcessing({ ...source, HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS: "10000" }, request);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toMatchObject({ kind: "retry_later" });
    expect(commandHostedRuntimeOwner).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 10_000 }));
    expect(container.startSupervisedInvocation).not.toHaveBeenCalled();
  });

  it.each(["updated", "stale"] as const)("re-admits after exact retirement only when release is %s", async status => {
    const { source, container, binding } = harness();
    const retiring = owner({ phase: "retiring" });
    const successor = owner({ attemptId: "attempt-b", generation: "2" });
    container.readStandbySlotBinding.mockResolvedValue({ ...binding, state: "retired", userId: null, claimId: null });
    vi.mocked(commandHostedRuntimeOwner).mockImplementation(async ({ command }) => {
      if (command.operation === "release") return response(null, status);
      if (command.operation === "claim") return response(successor);
      return response(retiring, "updated");
    });
    const result = await ensurePostgresRuntimeProcessing(source, { ...request, admission: response(retiring) });
    expect(result).toMatchObject(status === "updated"
      ? { kind: "runtime_processing_accepted", action: "woken", runtimeAttemptId: "attempt-b" }
      : { kind: "retry_later" });
    expect(container.retireStandbySlot).toHaveBeenCalledOnce();
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([input]) => input.command.operation))
      .toEqual(status === "updated" ? ["retire", "release", "claim"] : ["retire", "release"]);
  });

  it("replaces a retired retained target in the same foreground request after background completion", async () => {
    const { source, container, binding } = harness();
    const completed = owner({ processingMode: "system_mailbox", phase: "retiring", completedAt: new Date().toISOString() });
    const retained = owner({ attemptId: "attempt-b", generation: "2", phase: "starting", workspaceVersion: null });
    const fresh = owner({ attemptId: "attempt-c", generation: "3", phase: "starting", workspaceVersion: null,
      runnerContainerName: null, allocationId: "standby-claim-22222222-2222-4222-8222-222222222222" });
    const claims = [completed, retained, fresh];
    container.readSupervisedInvocation.mockResolvedValue({ attemptId: "attempt-a", generation: "1", state: "completed", immediateRecheckRequested: false });
    const retired = { ...binding, state: "retired" as const, claimId: null, userId: null };
    container.resolveRetainedStandbySlot.mockResolvedValue(retired);
    container.readStandbySlotBinding.mockResolvedValue(retired);
    vi.mocked(commandHostedRuntimeOwner).mockImplementation(async ({ command }) => {
      if (command.operation === "claim") {
        const current = claims.shift();
        if (!current) throw new Error("Unexpected extra admission.");
        return response(current, current === completed ? "existing" : "claimed");
      }
      if (command.operation === "select_target") return response({ ...fresh, runnerContainerName: command.runnerContainerName }, "updated");
      return response(null, "updated");
    });
    expect(await ensurePostgresRuntimeProcessing(source, request)).toMatchObject({
      kind: "runtime_processing_accepted", runtimeAttemptId: "attempt-c", action: "started",
    });
    expect(container.retireStandbySlot).toHaveBeenCalledOnce();
    expect(container.readStandbySlotBinding).toHaveBeenCalledOnce();
    expect(container.startSupervisedInvocation).toHaveBeenCalledOnce();
    const operations = vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([input]) => input.command.operation);
    expect(operations).toEqual(["claim", "claim", "retire", "release", "claim", "select_target", "accepted"]);
  });

  it.each(["unchanged", "blocked", "foreign"] as const)("revalidates %s canonical admission after completed-owner recovery", async state => {
    const { source, container } = harness();
    const completed = owner({ processingMode: "system_mailbox", phase: "retiring", completedAt: new Date().toISOString() });
    container.readSupervisedInvocation.mockResolvedValue({ attemptId: "attempt-a", generation: "1", state: "completed", immediateRecheckRequested: false });
    vi.mocked(recordHostedRuntimeOwnerCompletion).mockResolvedValueOnce(false);
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValueOnce(response(completed))
      .mockResolvedValue(state === "blocked" ? response(null, "blocked")
        : response(state === "foreign" ? { ...completed, userId: "other-member", generation: "2" } : completed));
    const result = ensurePostgresRuntimeProcessing(source, request);
    if (state === "foreign") await expect(result).rejects.toThrow("different member");
    else await expect(result).resolves.toMatchObject({ kind: "retry_later" });
    expect(commandHostedRuntimeOwner).toHaveBeenCalledTimes(2);
    expect(recordHostedRuntimeOwnerCompletion).toHaveBeenCalledOnce();
    expect(container.startSupervisedInvocation).not.toHaveBeenCalled();
    expect(container.retireStandbySlot).not.toHaveBeenCalled();
  });

  it("bounds same-request recovery when other callers keep advancing the completed owner", async () => {
    const { source, container } = harness();
    let generation = 0;
    vi.mocked(commandHostedRuntimeOwner).mockImplementation(async () => {
      generation += 1;
      return response(owner({ attemptId: `attempt-${generation}`, generation: String(generation),
        phase: "retiring", completedAt: new Date().toISOString() }));
    });
    container.readSupervisedInvocation.mockImplementation(async () => ({ attemptId: `attempt-${generation}`,
      generation: String(generation), state: "completed", immediateRecheckRequested: false }));
    expect(await ensurePostgresRuntimeProcessing(source, request)).toMatchObject({ kind: "retry_later" });
    expect(commandHostedRuntimeOwner).toHaveBeenCalledTimes(3);
    expect(container.startSupervisedInvocation).not.toHaveBeenCalled();
    expect(container.retireStandbySlot).not.toHaveBeenCalled();
  });

  it("keeps a retained target pinned when native retirement is not confirmed", async () => {
    const { source, container, binding } = harness();
    const starting = owner({ phase: "starting", workspaceVersion: null });
    container.resolveRetainedStandbySlot.mockResolvedValue({ ...binding, state: "retired", userId: null, claimId: null });
    // The independent exact-stop read does not confirm retirement.
    container.readStandbySlotBinding.mockResolvedValue({ ...binding, state: "retiring" });
    vi.mocked(commandHostedRuntimeOwner).mockImplementation(async ({ command }) =>
      response(starting, command.operation === "claim" ? "claimed" : "updated"));
    expect(await ensurePostgresRuntimeProcessing(source, request)).toMatchObject({ kind: "retry_later" });
    expect(container.startSupervisedInvocation).not.toHaveBeenCalled();
    expect(container.bindStandbySlot).not.toHaveBeenCalled();
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([input]) => input.command.operation))
      .toEqual(["claim", "retire"]);
  });

  it("bounds a completion acknowledgment wait without launching a successor", async () => {
    vi.useFakeTimers();
    const { source, container } = harness();
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue(response(owner({ phase: "retiring", completedAt: new Date().toISOString() })));
    container.readSupervisedInvocation.mockResolvedValue({ attemptId: "attempt-a", generation: "1", state: "completed", immediateRecheckRequested: false });
    let complete!: (value: boolean) => void;
    vi.mocked(recordHostedRuntimeOwnerCompletion).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const diagnostics: RuntimeProcessingDiagnostics = { stage: "admission", details: {} };
    const result = ensurePostgresRuntimeProcessing(source, { ...request, commandTimeoutMs: 2_000 }, diagnostics);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toMatchObject({ kind: "retry_later" });
    expect(diagnostics.details.runtimeProcessingRetryReason).toBe("command_budget_exhausted");
    complete(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(commandHostedRuntimeOwner).toHaveBeenCalledOnce();
    expect(container.startSupervisedInvocation).not.toHaveBeenCalled();
  });

  it("returns a retry at command expiry without retiring or launching the uncertain owner", async () => {
    vi.useFakeTimers();
    const { source, container } = harness();
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValueOnce(response(owner({ phase: "starting" }), "claimed"))
      .mockResolvedValue(response(owner({ phase: "starting" }), "updated"));
    let ready!: (value: { kind: "ready" }) => void;
    container.ensureReadyForProcessing.mockImplementation(() => new Promise(resolve => { ready = resolve; }));
    const diagnostics: RuntimeProcessingDiagnostics = { stage: "admission", details: {} };
    const result = ensurePostgresRuntimeProcessing(source, { ...request, commandTimeoutMs: 2_000 }, diagnostics);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toMatchObject({ kind: "retry_later" });
    expect(diagnostics.details.runtimeProcessingRetryReason).toBe("command_budget_exhausted");
    ready({ kind: "ready" });
    await vi.advanceTimersByTimeAsync(0);
    expect(container.startSupervisedInvocation).not.toHaveBeenCalled();
    expect(container.retireStandbySlot).not.toHaveBeenCalled();
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([input]) => input.command.operation))
      .not.toContain("release");
  });

  it("forwards complete mailbox wake coverage to the existing exact runtime", async () => {
    const { source, container } = harness();
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue(response(owner(), "existing"));
    const mailboxWakeHighWater = { conversation: "4", system: "2" };
    expect(await ensurePostgresRuntimeProcessing(source, { ...request, mailboxWakeHighWater }))
      .toMatchObject({ kind: "runtime_processing_accepted", action: "woken" });
    expect(container.ensureProcessing).toHaveBeenCalledWith(expect.objectContaining({
      activeRuntime: expect.objectContaining({ mailboxWakeHighWater }),
    }));
  });

  it.each([true, false])("retains an ambiguously accepted launch after execution timeout (launch preparation: %s)", async (supported) => {
    const { source, container } = harness();
    container.ensureReadyForProcessing.mockResolvedValue({ kind: "ready", ...(supported ? { preparesSupervisedLaunch: true } : {}) });
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValueOnce(response(owner({ phase: "starting" }), "claimed"))
      .mockResolvedValue(response(owner({ phase: "starting" }), "updated"));
    container.startSupervisedInvocation.mockRejectedValue(new DOMException("Synthetic timeout", "TimeoutError"));
    const diagnostics: RuntimeProcessingDiagnostics = { stage: "admission", details: {} };
    expect(await ensurePostgresRuntimeProcessing(source, request, diagnostics)).toMatchObject({ kind: "retry_later" });
    expect(diagnostics.details.runtimeProcessingRetryReason).toBe("container_rpc_timeout");
    expect(container.startSupervisedInvocation).toHaveBeenCalledOnce();
    expect(container.retireStandbySlot).not.toHaveBeenCalled();
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([input]) => input.command.operation))
      .toEqual(supported ? ["claim"] : ["claim", "prepare_launch"]);
    // The next command observes that exact live owner rather than launching again.
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue(response(owner()));
    expect(await ensurePostgresRuntimeProcessing(source, request)).toMatchObject({ kind: "runtime_processing_accepted", action: "woken" });
    expect(container.startSupervisedInvocation).toHaveBeenCalledOnce();
  });

  it("defers a busy readiness result without launching or retiring the retained target", async () => {
    const { source, container } = harness();
    container.ensureReadyForProcessing.mockResolvedValue({ kind: "cleanup_unsettled" });
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue(response(owner({ phase: "starting" }), "claimed"));
    const diagnostics: RuntimeProcessingDiagnostics = { stage: "admission", details: {} };
    await expect(ensurePostgresRuntimeProcessing(source, request, diagnostics)).resolves.toMatchObject({ kind: "retry_later" });
    expect(diagnostics.details.runtimeProcessingRetryReason).toBe("container_not_ready");
    expect(container.startSupervisedInvocation).not.toHaveBeenCalled();
    expect(container.retireStandbySlot).not.toHaveBeenCalled();
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([input]) => input.command.operation)).toEqual(["claim"]);
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

  it.each([
    ["draining", "cutover_blocked"],
    ["missing-owner", "claim_blocked"],
    ["uncertain-wake", "wake_unconfirmed"],
  ] as const)("records the actual bounded retry reason for %s", async (scenario, reason) => {
    const { source, container } = harness();
    const diagnostics: RuntimeProcessingDiagnostics = { stage: "admission", details: {} };
    if (scenario === "draining") vi.mocked(commandHostedRuntimeOwner).mockResolvedValueOnce({ cutover: "draining", status: "blocked", owner: null });
    else vi.mocked(commandHostedRuntimeOwner).mockResolvedValue(response(scenario === "missing-owner" ? null : owner()));
    if (scenario === "uncertain-wake") container.ensureProcessing.mockRejectedValueOnce(new Error("synthetic transport failure"));
    await expect(ensurePostgresRuntimeProcessing(source, request, diagnostics)).resolves.toMatchObject({ kind: "retry_later" });
    expect(diagnostics.details.runtimeProcessingRetryReason).toBe(reason);
    if (scenario === "uncertain-wake") expect(diagnostics).toMatchObject({ attemptId: "attempt-a", leaseGeneration: "1", stage: "active_wake" });
  });

  it.each(["legacy", "draining"] as const)("keeps an unretired %s database closed without calling a legacy object", async cutover => {
    const { source, container } = harness();
    const legacy = vi.fn(() => { throw new Error("Legacy namespace must not be accessed."); });
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue({ cutover, status: "blocked", owner: null });
    expect(await ensurePostgresRuntimeProcessing({ ...source, USER_RUNNER: { getByName: legacy } }, request))
      .toMatchObject({ kind: "retry_later" });
    expect(commandHostedRuntimeOwner).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ command: { operation: "claim", processingMode: "default" } }));
    expect(legacy).not.toHaveBeenCalled();
    expect(container.startSupervisedInvocation).not.toHaveBeenCalled();
    expect(container.retireStandbySlot).not.toHaveBeenCalled();
  });

  it.each([undefined, "false", "true"])("starts a new Postgres member without the retired deployment flag (%s)", async flag => {
    const { source, container } = harness();
    const legacy = vi.fn(() => { throw new Error("Legacy namespace must not be accessed."); });
    vi.mocked(commandHostedRuntimeOwner).mockImplementation(async ({ command }) =>
      response(owner({ phase: "starting", workspaceVersion: null }), command.operation === "claim" ? "claimed" : "updated"));
    expect(await ensurePostgresRuntimeProcessing({ ...source, HOSTED_RUNTIME_POSTGRES_ENABLED: flag,
      USER_RUNNER: { getByName: legacy } }, request))
      .toMatchObject({ kind: "runtime_processing_accepted", action: "started" });
    expect(legacy).not.toHaveBeenCalled();
    expect(container.startSupervisedInvocation).toHaveBeenCalledOnce();
  });

  it("wakes the exact live owner and forwards foreground promotion in place", async () => {
    const { source, container } = harness();
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue(response(owner({ processingMode: "system_mailbox" })));
    expect(await ensurePostgresRuntimeProcessing(source, { ...request, voiceCallId: "call-synthetic" })).toMatchObject({ kind: "runtime_processing_accepted", action: "woken", runtimeAttemptId: "attempt-a" });
    expect(container.ensureProcessing).toHaveBeenCalledWith(expect.objectContaining({ activeRuntime: expect.objectContaining({ attemptId: "attempt-a", leaseGeneration: "1", requestedProcessingMode: "default", voiceCallId: "call-synthetic" }) }));
    expect(container.readSupervisedInvocation).not.toHaveBeenCalled();
    expect(container.readActiveRuntimeUserFence).not.toHaveBeenCalled();
    expect(container.startSupervisedInvocation).not.toHaveBeenCalled();
  });

  it("still preempts retention when foreground work requests processing", async () => {
    const { source, container, binding } = harness();
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValueOnce(response(owner({ processingMode: "inbox_media_retention" })))
      .mockResolvedValue(response(null, "updated"));
    container.readStandbySlotBinding.mockResolvedValue({ ...binding, state: "retired", claimId: null, userId: null });
    expect(await ensurePostgresRuntimeProcessing(source, request)).toMatchObject({ kind: "retry_later" });
    expect(container.ensureProcessing).not.toHaveBeenCalled();
    expect(container.retireStandbySlot).toHaveBeenCalledOnce();
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([input]) => input.command.operation)).toEqual(["claim", "retire", "release", "claim"]);
  });

  it.each(["default", "system_mailbox"] as const)("recovers an inactive %s owner before admitting retention", async processingMode => {
    const { source, container, binding } = harness();
    const failed = owner({ processingMode, lastErrorCode: "runtime_error" });
    const successor = owner({ attemptId: "attempt-b", generation: "2", processingMode: "inbox_media_retention", phase: "starting" });
    container.readSupervisedInvocation.mockResolvedValue({ attemptId: "attempt-a", generation: "1", state: "registered", immediateRecheckRequested: false });
    container.readStandbySlotBinding.mockResolvedValue({ ...binding, state: "retired", claimId: null, userId: null });
    vi.mocked(commandHostedRuntimeOwner).mockImplementation(async ({ command }) =>
      command.operation === "claim" ? response(successor, "claimed") : response(successor, "updated"));

    expect(await ensurePostgresRuntimeProcessing(source, { ...request, processingMode: "inbox_media_retention", admission: response(failed) }))
      .toMatchObject({ kind: "runtime_processing_accepted", action: "started", runtimeAttemptId: "attempt-b" });
    expect(container.readActiveRuntimeUserFence).toHaveBeenCalledOnce();
    expect(container.ensureProcessing).not.toHaveBeenCalled();
    expect(container.retireStandbySlot).toHaveBeenCalledOnce();
    expect(container.startSupervisedInvocation).toHaveBeenCalledOnce();
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([input]) => input.command.operation))
      .toEqual(["retire", "release", "claim", "accepted"]);
    expect(commandHostedRuntimeOwner).toHaveBeenCalledWith(expect.objectContaining({
      command: { operation: "retire", attemptId: "attempt-a", generation: "1", completed: false },
    }));
  });

  it.each(["active", "mismatch", "unavailable", "starting"] as const)("preserves the owner during conflicting retention admission (%s)", async scenario => {
    const { source, container } = harness();
    const current = owner({ processingMode: "system_mailbox", ...(scenario === "starting" ? { phase: "starting" } : {}) });
    if (scenario === "active" || scenario === "mismatch") {
      container.readActiveRuntimeUserFence.mockResolvedValue({ active: true, userId: request.userId,
        attemptId: scenario === "active" ? "attempt-a" : "attempt-b", leaseGeneration: "1" });
    } else if (scenario === "unavailable") {
      container.readActiveRuntimeUserFence.mockRejectedValue(new Error("synthetic liveness unavailable"));
    }
    const diagnostics: RuntimeProcessingDiagnostics = { stage: "admission", details: {} };

    expect(await ensurePostgresRuntimeProcessing(source, { ...request, processingMode: "inbox_media_retention", admission: response(current) }, diagnostics))
      .toMatchObject({ kind: "retry_later" });
    expect(container.readActiveRuntimeUserFence).toHaveBeenCalledOnce();
    expect(diagnostics.details.runtimeProcessingRetryReason).toBe(scenario === "starting" ? "starting_fence_preserved" : "processing_mode_conflict");
    expect(commandHostedRuntimeOwner).not.toHaveBeenCalled();
    expect(container.ensureProcessing).not.toHaveBeenCalled();
    expect(container.retireStandbySlot).not.toHaveBeenCalled();
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

  it("wakes a Web-admitted owner without a Web claim or native receipt round trip", async () => {
    const { source, container } = harness();
    const admission = response(owner({ processingMode: "system_mailbox" }));
    expect(await ensurePostgresRuntimeProcessing(source, { ...request, admission }))
      .toMatchObject({ kind: "runtime_processing_accepted", action: "woken" });
    expect(commandHostedRuntimeOwner).not.toHaveBeenCalled();
    expect(container.readSupervisedInvocation).not.toHaveBeenCalled();
    expect(container.ensureProcessing).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      activeRuntime: expect.objectContaining({ attemptId: "attempt-a", leaseGeneration: "1", requestedProcessingMode: "default" }),
    }));
  });

  it("launches a Web-created claim using the existing fenced startup path", async () => {
    const { source, container } = harness();
    const admission = response(owner({ phase: "starting", workspaceVersion: null }), "claimed");
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue(response(owner(), "updated"));
    expect(await ensurePostgresRuntimeProcessing(source, { ...request, admission }))
      .toMatchObject({ kind: "runtime_processing_accepted", action: "started" });
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([input]) => input.command.operation)).toEqual(["accepted"]);
    expect(container.startSupervisedInvocation).toHaveBeenCalledOnce();
  });

  it("rejects another member's supplied admission before container work", async () => {
    const { source, container } = harness();
    await expect(ensurePostgresRuntimeProcessing(source, {
      ...request, admission: response(owner({ userId: "member-other" })),
    })).rejects.toThrow("different member");
    expect(commandHostedRuntimeOwner).not.toHaveBeenCalled();
    expect(container.ensureProcessing).not.toHaveBeenCalled();
    expect(container.startSupervisedInvocation).not.toHaveBeenCalled();
  });

  it("does not retire or replace a successor when supplied admission is stale", async () => {
    const { source, container } = harness();
    container.ensureProcessing.mockResolvedValue({ kind: "start-required", reason: "no-active-child" });
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue(response(null, "stale"));
    expect(await ensurePostgresRuntimeProcessing(source, { ...request, admission: response(owner()) }))
      .toMatchObject({ kind: "retry_later" });
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([input]) => input.command)).toEqual([
      { operation: "retire", attemptId: "attempt-a", generation: "1", completed: false },
    ]);
    expect(container.retireStandbySlot).not.toHaveBeenCalled();
    expect(container.startSupervisedInvocation).not.toHaveBeenCalled();
  });

  it("does not reconcile a completed receipt while liveness is unknown", async () => {
    const { source, container } = harness();
    container.ensureProcessing.mockResolvedValue({ kind: "wake-unconfirmed", reason: "active-child-rejected" });
    container.readSupervisedInvocation.mockResolvedValue({ attemptId: "attempt-a", generation: "1", state: "completed", immediateRecheckRequested: true });
    container.readActiveRuntimeUserFence.mockRejectedValue(new Error("synthetic unavailable liveness"));
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue(response(owner()));
    expect(await ensurePostgresRuntimeProcessing(source, request)).toMatchObject({ kind: "retry_later" });
    expect(commandHostedRuntimeOwner).toHaveBeenCalledTimes(1);
    expect(recordHostedRuntimeOwnerCompletion).not.toHaveBeenCalled();
    expect(container.startSupervisedInvocation).not.toHaveBeenCalled();
    expect(container.retireStandbySlot).not.toHaveBeenCalled();
  });

  it("retains recovery when the settled completion command rejects the old owner", async () => {
    const { source, container } = harness();
    container.ensureProcessing.mockResolvedValue({ kind: "start-required", reason: "no-active-child" });
    container.readSupervisedInvocation.mockResolvedValue({ attemptId: "attempt-a", generation: "1", state: "completed", immediateRecheckRequested: false });
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue(response(owner()));
    vi.mocked(recordHostedRuntimeOwnerCompletion).mockResolvedValueOnce(false);
    expect(await ensurePostgresRuntimeProcessing(source, request)).toMatchObject({ kind: "retry_later" });
    expect(commandHostedRuntimeOwner).toHaveBeenCalledTimes(2);
    expect(recordHostedRuntimeOwnerCompletion).toHaveBeenCalledOnce();
    expect(container.startSupervisedInvocation).not.toHaveBeenCalled();
    expect(container.retireStandbySlot).not.toHaveBeenCalled();
  });

  it("retires retention work before replacing it with foreground work", async () => {
    const { source, container, binding } = harness();
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValueOnce(response(owner({ processingMode: "inbox_media_retention" })))
      .mockResolvedValue(response(null, "updated"));
    container.readStandbySlotBinding.mockResolvedValue({ ...binding, state: "retired", claimId: null, userId: null });
    expect(await ensurePostgresRuntimeProcessing(source, request)).toMatchObject({ kind: "retry_later" });
    expect(container.ensureProcessing).not.toHaveBeenCalled();
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([input]) => input.command.operation))
      .toEqual(["claim", "retire", "release", "claim"]);
    expect(container.startSupervisedInvocation).not.toHaveBeenCalled();
  });

  it("does not wake foreground work in response to a retention request", async () => {
    const { source, container } = harness();
    container.readActiveRuntimeUserFence.mockResolvedValue({ active: true, userId: request.userId,
      attemptId: "attempt-a", leaseGeneration: "1" });
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue(response(owner()));
    expect(await ensurePostgresRuntimeProcessing(source, { ...request, processingMode: "inbox_media_retention" }))
      .toMatchObject({ kind: "retry_later" });
    expect(container.ensureProcessing).not.toHaveBeenCalled();
    expect(commandHostedRuntimeOwner).toHaveBeenCalledTimes(1);
    expect(container.retireStandbySlot).not.toHaveBeenCalled();
  });

  it.each([5, 29])("rechecks a starting owner promptly without early retirement at second %s", async second => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`2026-01-01T00:00:${second.toString().padStart(2, "0")}Z`));
    const { source, container } = harness();
    const starting = owner({ phase: "starting", workspaceVersion: null, startedAt: "2026-01-01T00:00:00Z" });
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue(response(starting));
    expect(await ensurePostgresRuntimeProcessing(source, request)).toEqual({
      kind: "retry_later", retryAt: second === 5 ? "2026-01-01T00:00:06.000Z" : "2026-01-01T00:00:30.000Z",
    });
    expect(container.retireStandbySlot).not.toHaveBeenCalled();
    expect(container.startSupervisedInvocation).not.toHaveBeenCalled();
    vi.setSystemTime(new Date(second === 5 ? "2026-01-01T00:00:06Z" : "2026-01-01T00:00:30Z"));
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue(response(owner()));
    expect(await ensurePostgresRuntimeProcessing(source, request)).toMatchObject({ kind: "runtime_processing_accepted", action: "woken" });
    expect(container.ensureProcessing).toHaveBeenCalledOnce();
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
    expect(operations).toEqual(["claim", "retire", "release", "claim"]);
    expect(container.startSupervisedInvocation).not.toHaveBeenCalled();
  });

  it("keeps an uncertain native stop pinned", async () => {
    const { source, container } = harness();
    container.retireStandbySlot.mockRejectedValue(new Error("synthetic stop uncertainty"));
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValueOnce(response(owner({ phase: "retiring" }))).mockResolvedValue(response(null, "updated"));
    await expect(ensurePostgresRuntimeProcessing(source, request)).rejects.toThrow("stop uncertainty");
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([input]) => input.command.operation)).toEqual(["claim", "retire"]);
  });

  it.each(["stopped", "unknown", "retiring", "web-admitted"] as const)("reconciles a lost completion acknowledgment and starts the successor in the retained warm shell (%s)", async state => {
    const { source, container } = harness();
    container.ensureProcessing.mockResolvedValue(state === "unknown"
      ? { kind: "wake-unconfirmed", reason: "active-child-rejected" }
      : { kind: "start-required", reason: "no-active-child" });
    container.readSupervisedInvocation.mockResolvedValue({ attemptId: "attempt-a", generation: "1", state: "completed", immediateRecheckRequested: true });
    const admission = response(owner(state === "retiring" ? { phase: "retiring", completedAt: new Date().toISOString() } : {}));
    if (state !== "web-admitted") vi.mocked(commandHostedRuntimeOwner).mockResolvedValueOnce(admission);
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValueOnce(response(owner({ attemptId: "attempt-b", generation: "2", phase: "starting", workspaceVersion: null }), "claimed"))
      .mockResolvedValue(response(owner({ attemptId: "attempt-b", generation: "2" }), "updated"));
    expect(await ensurePostgresRuntimeProcessing(source, { ...request, ...(state === "web-admitted" ? { admission } : {}) })).toMatchObject({ kind: "runtime_processing_accepted", runtimeAttemptId: "attempt-b" });
    expect(recordHostedRuntimeOwnerCompletion).toHaveBeenCalledWith(expect.objectContaining({ attemptId: "attempt-a", settledRunnerContainerName: target, result: { immediateRecheckRequested: true } }));
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.some(([input]) => input.command.operation === "release_completed")).toBe(false);
    expect(container.resolveRetainedStandbySlot).toHaveBeenCalled();
    expect(container.bindStandbySlot).not.toHaveBeenCalled();
    expect(container.retireStandbySlot).not.toHaveBeenCalled();
    expect(container.ensureProcessing).toHaveBeenCalledTimes(state === "retiring" ? 0 : 1);
    expect(container.startSupervisedInvocation).toHaveBeenCalledTimes(1);
    const token = container.startSupervisedInvocation.mock.calls[0]?.[0]?.job.request.providerEgressToken;
    expect(token).toMatch(/^provider-egress-[a-f0-9]{64}$/u);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token!)));
    const hash = Array.from(digest, value => value.toString(16).padStart(2, "0")).join("");
    expect(container.startSupervisedInvocation).toHaveBeenCalledWith(expect.objectContaining({
      launch: expect.objectContaining({ providerEgressTokenHash: hash }),
    }));
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([input]) => input.command.operation))
      .toEqual([...(state === "web-admitted" ? [] : ["claim"]), "claim", "accepted"]);
    expect(JSON.stringify(vi.mocked(commandHostedRuntimeOwner).mock.calls)).not.toContain(token);
  });
});
