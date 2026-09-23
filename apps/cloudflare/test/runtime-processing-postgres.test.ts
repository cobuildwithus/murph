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
    ensureProcessing: vi.fn(async (): Promise<import("../src/runner-container.ts").RunnerContainerEnsureProcessingResult> => ({ kind: "accepted", action: "woken" })),
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
    expect(await ensurePostgresRuntimeProcessing(source, request)).toMatchObject({ kind: "runtime_processing_accepted", action: "woken", runtimeAttemptId: "attempt-a" });
    expect(container.ensureProcessing).toHaveBeenCalledWith(expect.objectContaining({ activeRuntime: expect.objectContaining({ attemptId: "attempt-a", leaseGeneration: "1", requestedProcessingMode: "default" }) }));
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
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([input]) => input.command.operation)).toEqual(["claim", "retire", "release"]);
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
    expect(commandHostedRuntimeOwner).toHaveBeenCalledTimes(1);
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
      .toEqual(["claim", "retire", "release"]);
    expect(container.startSupervisedInvocation).not.toHaveBeenCalled();
  });

  it("does not wake foreground work in response to a retention request", async () => {
    const { source, container } = harness();
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue(response(owner()));
    expect(await ensurePostgresRuntimeProcessing(source, { ...request, processingMode: "inbox_media_retention" }))
      .toMatchObject({ kind: "retry_later" });
    expect(container.ensureProcessing).not.toHaveBeenCalled();
    expect(commandHostedRuntimeOwner).toHaveBeenCalledTimes(1);
    expect(container.retireStandbySlot).not.toHaveBeenCalled();
  });

  it("waits for the preserved startup deadline and still accepts an earlier ready wake", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:05Z"));
    const { source, container } = harness();
    const starting = owner({ phase: "starting", workspaceVersion: null, startedAt: "2026-01-01T00:00:00Z" });
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue(response(starting));
    expect(await ensurePostgresRuntimeProcessing(source, request)).toEqual({
      kind: "retry_later", retryAt: "2026-01-01T00:00:30.000Z",
    });
    expect(container.retireStandbySlot).not.toHaveBeenCalled();
    expect(container.startSupervisedInvocation).not.toHaveBeenCalled();
    vi.setSystemTime(new Date("2026-01-01T00:00:12Z"));
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
