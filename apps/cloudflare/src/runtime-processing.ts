import { observeRuntimeProcessingFence, type RuntimeProcessingDiagnostics } from "./user-runner/diagnostics.ts";
import type { HostedRuntimeEnsureProcessingResponse } from "@murphai/hosted-execution/orchestration-control";
import { emitHostedExecutionStructuredLog } from "@murphai/hosted-execution";
import { parseHostedWorkspaceReadResponse } from "@murphai/hosted-execution/parsers";
import { HOSTED_RUNTIME_WORKSPACE_PATH } from "@murphai/hosted-execution/routes";
import type { HostedRuntimeOwnerCommand, HostedRuntimeOwnerSnapshot } from "@murphai/hosted-execution/runtime-owner";
import { readHostedExecutionEnvironment } from "./env.ts";
import { asWorkerStringEnvironment } from "./worker-contracts.ts";
import type { WorkerEnvironmentSource } from "./worker-routes/shared.ts";
import { commandHostedRuntimeOwner } from "./runtime-owner-client.ts";
import { recordHostedRuntimeOwnerCompletion } from "./runtime-owner-completion.ts";
import { RuntimeInvocationPreparation } from "./runtime-invocation-preparation.ts";
import { RunnerStoreCache } from "./user-runner/runner-store-cache.ts";
import type { HostedRuntimeEnsureProcessingRequest } from "@murphai/hosted-execution/orchestration-control";
import type { HostedRuntimeLatencyPhaseBreakdown } from "@murphai/hosted-execution/runtime-control";

import { createRuntimeProcessingCommandBudget, isRuntimeProcessingCommandBudgetTimeout, readRuntimeProcessingCommandStepTimeoutMs, runRuntimeProcessingCommandStep } from "./user-runner/runtime-command-budget.ts";
import { computeRuntimeProcessingOwnerRecheckAt } from "./user-runner/runtime-processing-responses.ts";
import { ensureActiveRuntimeProcessing } from "./user-runner/runtime-container-wake.ts";
import { readRuntimeFenceLivenessBestEffort } from "./user-runner/runtime-fence-liveness.ts";
import type { RunnerWriteFenceToken } from "./runtime-invocation-token.ts";
import { fetchHostedExecutionWebControlPlaneResponse } from "./web-control-plane.ts";
import {
  createHostedRunnerContainerNamespaceRouter, HOSTED_RUNNER_REGION, HOSTED_STANDBY_CLAIM_TIMEOUT_MS,
  isHostedStandbyClaimId, readHostedStandbyMode, resolveHostedRunnerReleaseId,
  resolveHostedStandbyCoordinatorName, readHostedRunnerTargetIdentity, requireHostedRunnerSlotLifecycle,
  type HostedStandbySlotBinding,
} from "./standby-runner-contract.ts";

type RuntimeProcessingInput = HostedRuntimeEnsureProcessingRequest & {
  commandStartedAtEpochMs?: number;
  commandTimeoutMs?: number;
  orchestration?: NonNullable<HostedRuntimeLatencyPhaseBreakdown["orchestration"]> | null;
  userId: string;
};

type RuntimeProcessingSource = Pick<WorkerEnvironmentSource, "BUNDLES" | "RUNNER_CONTAINER" | "NEXT_RUNNER_CONTAINER" | "STANDBY_RUNNER_CONTAINER" | "STANDBY_COORDINATOR"> & Readonly<Record<string, unknown>>;
type ProcessingContext = ReturnType<typeof createProcessingContext> & {
  namespace: NonNullable<ReturnType<typeof createHostedRunnerContainerNamespaceRouter>>;
};

/** Postgres owns admission; the immutable native target owns execution evidence. */
export async function ensurePostgresRuntimeProcessing(source: RuntimeProcessingSource, input: RuntimeProcessingInput, diagnostics: RuntimeProcessingDiagnostics = { stage: "admission", details: {} }): Promise<HostedRuntimeEnsureProcessingResponse> {
  const context = createProcessingContext(source, input, diagnostics);
  try {
    return await ensureRuntimeProcessing(context);
  } catch (error) {
    // A deadline says nothing about whether the remote operation committed or
    // the process is still live. Reconcile the same owner on the next command.
    if (!isProcessingTimeout(error)) throw error;
    return retryProcessing(context, isRuntimeProcessingCommandBudgetTimeout(error) ? "command_budget_exhausted" : "container_rpc_timeout");
  }
}

function isProcessingTimeout(error: unknown): boolean {
  return isRuntimeProcessingCommandBudgetTimeout(error)
    || (error instanceof Error && error.name === "TimeoutError");
}

async function ensureRuntimeProcessing(context: ReturnType<typeof createProcessingContext>): Promise<HostedRuntimeEnsureProcessingResponse> {
  const { diagnostics } = context;
  if (!context.namespace) return retryProcessing(context, "missing_container_binding");
  const ctx = { ...context, namespace: context.namespace };
  let claim = context.input.admission ?? await ctx.command({ operation: "claim", processingMode: ctx.mode });
  let previousGeneration: string | undefined;
  // One completed owner, one expired retained target, then its fresh successor.
  // Contention beyond these bounded transitions belongs to the existing retry owner.
  for (let admission = 0; admission < 3; admission += 1) {
    if (claim.cutover !== "postgres") return retryProcessing(ctx, "cutover_blocked");
    const owner = claim.owner;
    if (!owner || (claim.status !== "claimed" && claim.status !== "existing")) return retryProcessing(ctx, "claim_blocked");
    if (owner.userId !== ctx.input.userId) throw new TypeError("Runtime admission belongs to a different member.");
    if (owner.generation === previousGeneration) return retryProcessing(ctx, "claim_blocked");
    previousGeneration = owner.generation;
    if (owner.attemptId && owner.processingMode) observeRuntimeProcessingFence(diagnostics, {
      attemptId: owner.attemptId, generation: owner.generation, processingMode: owner.processingMode,
    });
    let outcome: HostedRuntimeEnsureProcessingResponse | null;
    if (claim.status === "existing") {
      diagnostics.stage = "liveness";
      // The wake validates the exact live attempt. Read its receipt only for recovery.
      const wake = await wakeExistingRuntime(ctx, owner);
      if (wake?.kind === "runtime_processing_accepted") return wake;
      outcome = await reconcileExistingRuntime(ctx, owner, wake);
    } else {
      outcome = await startClaimedRuntime(ctx, owner);
    }
    if (outcome) return outcome;
    if (admission < 2) claim = await ctx.command({ operation: "claim", processingMode: ctx.mode });
  }
  return retryProcessing(ctx, "claim_blocked");
}

function createProcessingContext(source: RuntimeProcessingSource, input: RuntimeProcessingInput, diagnostics: RuntimeProcessingDiagnostics) {
  const env = readHostedExecutionEnvironment(asWorkerStringEnvironment(source));
  const budget = createRuntimeProcessingCommandBudget({ commandTimeoutMs: input.commandTimeoutMs ?? null,
    startedAtMs: input.commandStartedAtEpochMs ?? Date.now() });
  const step = async <T>(operationName: string, operation: () => Promise<T>, timeoutMs = budget.deadlineAtMs - Date.now()): Promise<T> => {
    const startedAt = Date.now();
    try {
      return await runRuntimeProcessingCommandStep({ budget, operation, stepTimeoutMs: timeoutMs });
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "worker", phase: "runtime.starting", level: "warn", error,
        message: "Hosted runtime processing step failed.",
        details: { operationName, elapsedMs: Date.now() - startedAt,
          remainingBudgetMs: Math.max(0, budget.deadlineAtMs - Date.now()),
          processingMode: input.processingMode ?? "default", timeout: isProcessingTimeout(error) },
      });
      throw error;
    }
  };
  const command = (value: HostedRuntimeOwnerCommand) => step(`owner_${value.operation}`, () => commandHostedRuntimeOwner({ source, userId: input.userId, command: value,
    timeoutMs: readRuntimeProcessingCommandStepTimeoutMs({ budget, stepTimeoutMs: env.webControlTimeoutMs }) }), env.webControlTimeoutMs);
  const namespace = createHostedRunnerContainerNamespaceRouter({ exactUser: source.RUNNER_CONTAINER,
    next: source.NEXT_RUNNER_CONTAINER, standby: source.STANDBY_RUNNER_CONTAINER ?? null });
  return { source, input, env, budget, step, command, namespace, diagnostics, mode: input.processingMode ?? "default" };
}

function retryProcessing(ctx: { diagnostics: RuntimeProcessingDiagnostics }, reason:
  | "cutover_blocked" | "missing_container_binding"
  | "claim_blocked" | "retirement_pending" | "completion_unconfirmed" | "starting_fence_preserved"
  | "processing_mode_conflict" | "wake_unconfirmed" | "container_not_ready"
  | "command_budget_exhausted" | "container_rpc_timeout" | "background_standby_deferred",
  retryAtEpochMs = Date.now() + 3_000,
): HostedRuntimeEnsureProcessingResponse {
  ctx.diagnostics.details.runtimeProcessingRetryReason = reason;
  return { kind: "retry_later", retryAt: new Date(retryAtEpochMs).toISOString() };
}
function acceptedProcessing(ctx: ProcessingContext, owner: HostedRuntimeOwnerSnapshot, action: "started" | "woken" | "already_running"): HostedRuntimeEnsureProcessingResponse {
  return { kind: "runtime_processing_accepted", action, runtimeAttemptId: requireIdentity(owner).attemptId,
    recommendedRecheckAt: computeRuntimeProcessingOwnerRecheckAt({ env: ctx.env }) };
}

async function retireRuntime(ctx: ProcessingContext, owner: HostedRuntimeOwnerSnapshot): Promise<HostedRuntimeEnsureProcessingResponse | null> {
  const identity = requireIdentity(owner);
  if ((await ctx.command({ operation: "retire", ...identity, completed: false })).status !== "updated") return retryProcessing(ctx, "retirement_pending");
  if (owner.runnerContainerName) {
    const target = owner.runnerContainerName;
    const slot = requireHostedRunnerSlotLifecycle(ctx.namespace.getByName(target));
    await ctx.step("retire_target", () => slot.retireStandbySlot({ ...(owner.allocationId ? { claimId: owner.allocationId } : {}),
      target: { slotName: target, userId: ctx.input.userId } }));
    const binding = await ctx.step("read_retired_binding", () => slot.readStandbySlotBinding());
    if (binding.state !== "retired" || binding.slotName !== target) return retryProcessing(ctx, "retirement_pending");
  }
  return (await ctx.command({ operation: "release", ...identity, runnerContainerName: owner.runnerContainerName })).status === "updated"
    ? null : retryProcessing(ctx, "retirement_pending");
}

/** A null result requests fresh canonical admission after settled recovery. */
async function reconcileExistingRuntime(ctx: ProcessingContext, owner: HostedRuntimeOwnerSnapshot, wake: HostedRuntimeEnsureProcessingResponse | null): Promise<HostedRuntimeEnsureProcessingResponse | null> {
  const identity = requireIdentity(owner);
  if (owner.phase === "retiring" && !owner.completedAt) {
    return retireRuntime(ctx, owner);
  }
  const container = owner.runnerContainerName ? ctx.namespace.getByName(owner.runnerContainerName) : null;
  const receipt = container?.readSupervisedInvocation
    ? await ctx.step("read_invocation", () => container.readSupervisedInvocation!({ userId: ctx.input.userId })).catch(() => null) : null;
  if (receipt?.state === "completed" && receipt.attemptId === identity.attemptId && receipt.generation === identity.generation && owner.runnerContainerName) {
    return await reconcileCompletedRuntime(ctx, owner, receipt.immediateRecheckRequested) ? null : retryProcessing(ctx, "completion_unconfirmed");
  }
  if (owner.phase === "retiring" || (owner.processingMode === "inbox_media_retention" && ctx.mode !== "inbox_media_retention")) {
    return retireRuntime(ctx, owner);
  }
  if (wake) return wake;
  // Age decides when to attempt retirement; it never proves stoppedness.
  const startingDeadline = owner.startedAt ? Date.parse(owner.startedAt) + 30_000 : 0;
  if (owner.phase === "starting" && startingDeadline > Date.now()) {
    // Recheck readiness promptly; the retirement deadline is not a sleep deadline.
    return retryProcessing(ctx, "starting_fence_preserved", ctx.mode === "default" ? Math.min(startingDeadline, Date.now() + 1_000) : startingDeadline);
  }
  return retireRuntime(ctx, owner);
}

async function reconcileCompletedRuntime(ctx: ProcessingContext, owner: HostedRuntimeOwnerSnapshot, immediateRecheckRequested: boolean): Promise<boolean> {
  const runnerContainerName = owner.runnerContainerName;
  if (!runnerContainerName) return false;
  const identity = requireIdentity(owner);
  const live = await readRuntimeFenceLivenessBestEffort({ commandBudget: ctx.budget,
    identity: { ...identity, leaseGeneration: identity.generation, userId: ctx.input.userId },
    runnerContainerName: owner.runnerContainerName, runnerContainerNamespace: ctx.namespace, stepTimeoutMs: 1_000 });
  if (live.outcome !== "inactive") return false;
  await ctx.step("complete_invocation", () => recordHostedRuntimeOwnerCompletion({
    source: ctx.source, userId: ctx.input.userId, ...identity,
    settledRunnerContainerName: runnerContainerName,
    result: immediateRecheckRequested ? { immediateRecheckRequested: true } : {},
  }), ctx.env.webControlTimeoutMs);
  // A stale result can mean a concurrent caller already released this owner.
  // Re-admit from Postgres; neither the old snapshot nor the receipt grants launch.
  return true;
}

async function wakeExistingRuntime(ctx: ProcessingContext, owner: HostedRuntimeOwnerSnapshot): Promise<HostedRuntimeEnsureProcessingResponse | null> {
  if (owner.phase === "retiring" || !owner.runnerContainerName || owner.workspaceVersion === null) return null;
  if (owner.processingMode === "inbox_media_retention" && ctx.mode !== "inbox_media_retention") return null;
  const identity = requireIdentity(owner);
  if (ctx.mode === "inbox_media_retention" && owner.processingMode !== ctx.mode) {
    // A mode mismatch protects live work, not a failed invocation's stale owner.
    // Inactive owners still pass through receipt, startup, and retirement proof.
    const live = await readRuntimeFenceLivenessBestEffort({ commandBudget: ctx.budget,
      identity: { ...identity, leaseGeneration: identity.generation, userId: ctx.input.userId },
      runnerContainerName: owner.runnerContainerName, runnerContainerNamespace: ctx.namespace, stepTimeoutMs: 1_000 });
    return live.outcome === "inactive" ? null : retryProcessing(ctx, "processing_mode_conflict");
  }
  ctx.diagnostics.stage = "active_wake";
  const wake = await ensureActiveRuntimeProcessing({ activeRuntime: {
    ...(ctx.input.voiceCallId ? { voiceCallId: ctx.input.voiceCallId } : {}),
    attemptId: identity.attemptId, leaseGeneration: identity.generation, userId: ctx.input.userId,
    processingMode: owner.processingMode, orchestration: ctx.input.orchestration,
    ...(ctx.input.mailboxWakeHighWater ? { mailboxWakeHighWater: ctx.input.mailboxWakeHighWater } : {}),
    ...(owner.processingMode === "system_mailbox" && ctx.mode === "default" ? { requestedProcessingMode: ctx.mode } : {}),
  }, diagnostics: ctx.diagnostics, commandBudget: ctx.budget, env: ctx.env,
    runnerContainerName: owner.runnerContainerName, runnerContainerNamespace: ctx.namespace, runnerRuntimeEnvSource: ctx.source });
  if (wake.kind === "accepted") return acceptedProcessing(ctx, owner, wake.action === "woken" ? "woken" : "already_running");
  return wake.kind === "wake-unconfirmed" ? retryProcessing(ctx, "wake_unconfirmed") : null;
}

async function startClaimedRuntime(ctx: ProcessingContext, initialOwner: HostedRuntimeOwnerSnapshot): Promise<HostedRuntimeEnsureProcessingResponse | null> {
  const claim = { owner: initialOwner };
  let start;
  try { start = await prepareClaimedRuntime(ctx, claim); }
  catch (error) {
    if (ctx.mode !== "system_mailbox") throw error;
    start = "defer" as const;
  }
  // Keep retirement outside preparation recovery: an uncertain stop stays pinned.
  if (start === "defer") return deferBackgroundRuntime(ctx, claim.owner);
  if (start === "retire") return retireRuntime(ctx, claim.owner);
  if ("kind" in start) return start;
  const { owner, binding, container, ready, prepared } = start;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(prepared.token.providerEgressToken!)));
  const launch = {
    providerEgressTokenHash: Array.from(digest, value => value.toString(16).padStart(2, "0")).join(""),
    customInferenceEnvelope: prepared.customInferenceEnvelope,
    platformAiUsageAllowed: prepared.platformAiUsageAllowed,
  };
  // Readiness already crosses this boundary. Its capability keeps rolling
  // Worker/controller versions compatible without another discovery request.
  if (!ready.preparesSupervisedLaunch) {
    const authority = await ctx.command({ operation: "prepare_launch", ...requireIdentity(owner), ...launch,
      runnerContainerName: binding.slotName, workspaceVersion: prepared.workspaceVersion, processingMode: prepared.token.processingMode });
    if (authority.status !== "updated" || !authority.owner) throw new Error("Hosted runtime preparation lost ownership.");
  }
  await ctx.step("start_invocation", () => container.startSupervisedInvocation!({ userId: ctx.input.userId, job: prepared.job,
    orchestration: prepared.input.orchestration, ...(ready.preparesSupervisedLaunch ? { launch } : {}) }));
  await ctx.command({ operation: "accepted", ...requireIdentity(owner) });
  return acceptedProcessing(ctx, owner, "started");
}

async function prepareClaimedRuntime(ctx: ProcessingContext, claim: { owner: HostedRuntimeOwnerSnapshot }) {
  ctx.diagnostics.stage = "fresh_start";
  observeRuntimeProcessingFence(ctx.diagnostics, { ...requireIdentity(claim.owner), processingMode: ctx.mode });
  // Foreground keeps its parallel workspace read. Background does no workspace
  // preparation until it has obtained warm capacity.
  const prepare = ctx.mode === "system_mailbox" ? null
    : createInvocationPreparation(ctx).prepareForFreshStart({ commandBudget: ctx.budget, input: ctx.input });
  const target = await bindRuntimeTarget(ctx, claim);
  if (target === "defer" || target === "retire") return target;
  const { owner, binding } = target;
  if (binding.state !== "bound" || binding.userId !== ctx.input.userId || binding.claimId !== owner.allocationId
    || binding.slotName !== owner.runnerContainerName) throw new Error("Hosted runtime target binding mismatch.");
  const container = ctx.namespace.getByName(binding.slotName);
  if (!container.ensureReadyForProcessing || !container.startSupervisedInvocation) throw new Error("Native runtime supervision is unavailable.");
  const readinessInput = { userId: ctx.input.userId, orchestrationAttemptId: ctx.input.orchestrationAttemptId,
    timeoutMs: readRuntimeProcessingCommandStepTimeoutMs({ budget: ctx.budget, stepTimeoutMs: ctx.mode === "system_mailbox" ? 3_000 : 15_000 }) };
  if (ctx.mode === "system_mailbox") {
    // No member workspace I/O until the warm probe succeeds. Keep command
    // budget for exact retirement if preparation fails or times out.
    if (!container.ensureWarmForBackgroundProcessing) return "defer" as const;
    const ready = await ctx.step("background_readiness", () => container.ensureWarmForBackgroundProcessing!(readinessInput), 3_000);
    if (ready.kind !== "ready") return "defer" as const;
    const prepareBackground = createInvocationPreparation(ctx).prepareForFreshStart({ commandBudget: ctx.budget, input: ctx.input });
    const prepared = await ctx.step("prepare_invocation", () => prepareBackground(ownerToken(owner), binding),
      Math.max(1, ctx.budget.deadlineAtMs - Date.now() - 3_000));
    return { owner, binding, container, ready, prepared };
  }
  const [ready, prepared] = await Promise.all([
    ctx.step("container_readiness", () => container.ensureReadyForProcessing!(readinessInput), 15_000),
    ctx.step("prepare_invocation", () => prepare!(ownerToken(owner), binding)),
  ]);
  if (ready.kind !== "ready") return retryProcessing(ctx, "container_not_ready");
  return { owner, binding, container, ready, prepared };
}

async function bindRuntimeTarget(ctx: ProcessingContext, claim: { owner: HostedRuntimeOwnerSnapshot }): Promise<{ owner: HostedRuntimeOwnerSnapshot; binding: HostedStandbySlotBinding } | "defer" | "retire"> {
  const { owner } = claim;
  const releaseId = resolveHostedRunnerReleaseId(ctx.source);
  if (owner.runnerContainerName) {
    const target = owner.runnerContainerName;
    const slot = requireHostedRunnerSlotLifecycle(ctx.namespace.getByName(target));
    const binding = await ctx.step("resolve_retained_target", () => slot.resolveRetainedStandbySlot({ currentReleaseId: releaseId,
      region: HOSTED_RUNNER_REGION, slotName: target, userId: ctx.input.userId }));
    if (binding.state !== "bound") return "retire";
    return { owner, binding };
  }
  if (!isHostedStandbyClaimId(owner.allocationId)) throw new Error("Hosted allocation identity is invalid.");
  const allocationId = owner.allocationId;
  const candidate = await allocateRuntimeTarget(ctx, allocationId, releaseId);
  if (!candidate) return "defer";
  const selected = await ctx.command({ operation: "select_target", ...requireIdentity(owner), runnerContainerName: candidate });
  if (!selected.owner?.runnerContainerName) throw new Error("Hosted runtime target selection lost ownership.");
  claim.owner = selected.owner;
  const target = selected.owner.runnerContainerName;
  const targetIdentity = readHostedRunnerTargetIdentity(target);
  if (!targetIdentity || targetIdentity.releaseId !== releaseId) throw new Error("Hosted runtime target release mismatch.");
  const slot = requireHostedRunnerSlotLifecycle(ctx.namespace.getByName(target));
  const bound = await ctx.step("bind_target", () => slot.bindStandbySlot({ claimId: allocationId, releaseId,
    region: HOSTED_RUNNER_REGION, slotName: target, userId: ctx.input.userId }));
  return { owner: selected.owner, binding: { ...bound, state: "bound" } };
}

/** A missed handoff never selected/bound a target. Late pool results remain
 * coordinator-owned orphans; stale owner identity cannot select or launch them. */
async function deferBackgroundRuntime(ctx: ProcessingContext, owner: HostedRuntimeOwnerSnapshot): Promise<HostedRuntimeEnsureProcessingResponse> {
  return await retireRuntime(ctx, owner) ?? retryProcessing(ctx, "background_standby_deferred",
    Date.now() + 15_000 + Math.floor(Math.random() * 15_000));
}

async function allocateRuntimeTarget(ctx: ProcessingContext, allocationId: string, releaseId: string): Promise<string | null> {
  const background = ctx.mode === "system_mailbox";
  const fallback = background ? null : `runner--v-${releaseId}--${allocationId.slice("standby-claim-".length).replaceAll("-", "")}`;
  if (readHostedStandbyMode(ctx.source) !== "allocate" || !ctx.source.STANDBY_COORDINATOR
    || (!background && (ctx.mode !== "default"
      || !(ctx.input.orchestration?.triggeredByWebDirect === true || ctx.input.conversationWorkPending === true)))) return fallback;
  try {
    const coordinator = ctx.source.STANDBY_COORDINATOR.getByName(resolveHostedStandbyCoordinatorName({ releaseId, region: HOSTED_RUNNER_REGION }));
    const request = { claimId: allocationId, releaseId, region: HOSTED_RUNNER_REGION,
      deadlineAtEpochMs: Math.min(ctx.budget.deadlineAtMs, Date.now() + HOSTED_STANDBY_CLAIM_TIMEOUT_MS) };
    const standby = await ctx.step("claim_standby", () => coordinator.claimReadyStandby(request), HOSTED_STANDBY_CLAIM_TIMEOUT_MS);
    return standby.outcome === "claimed" ? standby.slotName : fallback;
  } catch { return fallback; } // Unbound inventory retains its own orphan recovery.
}

function createInvocationPreparation(ctx: ProcessingContext) {
  const { env, namespace, source } = ctx;
  return new RuntimeInvocationPreparation({
    env, runnerContainerNamespace: namespace, runnerRuntimeEnvSource: source,
    runnerStoreCache: new RunnerStoreCache({ bucket: source.BUNDLES, env, runnerRuntimeEnvSource: source }),
    readHostedWebControlBaseUrl: () => env.hostedWebBaseUrl,
    assertWorkspaceBelongsToRunnerUser(workspace, userId) {
      if (workspace && workspace.userId !== userId) throw new Error("Hosted workspace member mismatch.");
    },
    async readHostedWorkspaceFromWeb(userId, options) {
      const response = await fetchHostedExecutionWebControlPlaneResponse({
        baseUrl: env.hostedWebBaseUrl, allowHttpHosts: env.hostedWebAllowHttpHosts,
        callbackSigning: env.webCallbackSigning, boundUserId: userId,
        method: "GET", path: HOSTED_RUNTIME_WORKSPACE_PATH, timeoutMs: options?.timeoutMs ?? env.webControlTimeoutMs,
      });
      if (!response.ok) throw new Error(`Hosted workspace read returned HTTP ${response.status}.`);
      return parseHostedWorkspaceReadResponse(await response.json());
    },
    async bindInvocation(facts) {
      // Provider APIs such as Linq use the invocation-scoped opaque token.
      // Persist only its digest; the raw capability travels in the launch job.
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const providerEgressToken = `provider-egress-${Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("")}`;
      return { ...facts.token, workspaceVersion: facts.workspaceVersion,
        processingMode: facts.processingMode ?? facts.token.processingMode, providerEgressToken };
    },
  });

}

function requireIdentity(owner: HostedRuntimeOwnerSnapshot) {
  if (!owner.attemptId) throw new Error("Hosted runtime owner has no active attempt.");
  return { attemptId: owner.attemptId, generation: owner.generation };
}

function ownerToken(owner: HostedRuntimeOwnerSnapshot): RunnerWriteFenceToken {
  if (!owner.startedAt || !owner.processingMode) throw new Error("Hosted runtime invocation facts are incomplete.");
  return { ...requireIdentity(owner), kind: "runtime", processingMode: owner.processingMode,
    providerEgressToken: null, runnerContainerName: owner.runnerContainerName, startedAt: owner.startedAt,
    userId: owner.userId, workspaceVersion: owner.workspaceVersion };
}
