import { deleteHostedUserR2DataBeforeStateDeletion } from "./user-runner/user-data-deletion.ts";
import type { HostedVoiceControlRequest, HostedVoiceControlResponse } from "@murphai/hosted-execution";
import { parseHostedRuntimeHealthDataAdmissionResponse, parseHostedRuntimeWebStatusResponse } from "@murphai/hosted-execution/parsers";
import { HOSTED_RUNTIME_HEALTH_DATA_ADMISSION_PATH, HOSTED_RUNTIME_STATUS_PATH } from "@murphai/hosted-execution/routes";
import type { HostedRuntimeOwnerSnapshot } from "@murphai/hosted-execution/runtime-owner";
import { readHostedExecutionEnvironment } from "./env.ts";
import { commandHostedRuntimeOwner } from "./runtime-owner-client.ts";
import { asWorkerStringEnvironment } from "./worker-contracts.ts";
import type { WorkerEnvironmentSource } from "./worker-routes/shared.ts";
import { fetchHostedExecutionWebControlPlaneResponse } from "./web-control-plane.ts";
import { readHostedWebControlPlaneResponseText } from "./runtime-platform/web-control-transport.ts";
import { createHostedRunnerContainerNamespaceRouter, requireHostedRunnerSlotLifecycle } from "./standby-runner-contract.ts";

type RuntimeUserControlSource = Pick<WorkerEnvironmentSource, "BUNDLES" | "RUNNER_CONTAINER" | "NEXT_RUNNER_CONTAINER" | "STANDBY_RUNNER_CONTAINER"> & Readonly<Record<string, unknown>>;

export async function controlPostgresRuntimeVoice(
  source: RuntimeUserControlSource, userId: string, request: HostedVoiceControlRequest,
): Promise<HostedVoiceControlResponse> {
  const { owner, cutover } = await commandHostedRuntimeOwner({ source, userId, command: { operation: "reconcile" } });
  if (cutover !== "postgres" || !owner || owner.attemptId !== request.attemptId
    || owner.generation !== request.leaseGeneration || !owner.runnerContainerName
    || owner.phase === "idle") return { kind: "unavailable" };
  if (request.action === "connect" && (owner.phase === "retiring" || !owner.platformAiUsageAllowed)) {
    return { kind: "unavailable" };
  }
  const namespace = createHostedRunnerContainerNamespaceRouter({
    exactUser: source.RUNNER_CONTAINER, next: source.NEXT_RUNNER_CONTAINER,
    standby: source.STANDBY_RUNNER_CONTAINER ?? null,
  });
  const container = namespace?.getByName(owner.runnerContainerName);
  if (!container?.controlVoice) return { kind: "unavailable" };
  return container.controlVoice({ ...request, userId });
}

async function readRuntimeControl(source: Readonly<Record<string, unknown>>, userId: string, path: string, search?: string) {
  const env = readHostedExecutionEnvironment(asWorkerStringEnvironment(source));
  const response = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: env.hostedWebBaseUrl, allowHttpHosts: env.hostedWebAllowHttpHosts,
    callbackSigning: env.webCallbackSigning, boundUserId: userId,
    method: "GET", path, search, timeoutMs: env.webControlTimeoutMs,
  });
  if (!response.ok) throw new Error(`Runtime control read returned HTTP ${response.status}.`);
  return JSON.parse(await readHostedWebControlPlaneResponseText({ response, description: "Runtime control",
    maxBytes: 1024 * 1024, signal: null, timeoutMs: env.webControlTimeoutMs }));
}

export async function readPostgresRunnerStatus(source: RuntimeUserControlSource, userId: string, options?: { logLimit?: number }) {
  const [ownership, status] = await Promise.all([
    commandHostedRuntimeOwner({ source, userId, command: { operation: "reconcile" } }),
    readRuntimeControl(source, userId, HOSTED_RUNTIME_STATUS_PATH,
      options?.logLimit === undefined ? undefined : `?logLimit=${options.logLimit}`).then(parseHostedRuntimeWebStatusResponse),
  ]);
  if (ownership.cutover !== "postgres" || status.userId !== userId || (status.workspace && status.workspace.userId !== userId)) {
    throw new Error("Runtime status authority is unavailable.");
  }
  return { ...status, inFlight: ownership.owner !== null && ownership.owner.phase !== "idle",
    lastInvocationAt: ownership.owner?.startedAt ?? null, lastErrorCode: ownership.owner?.lastErrorCode ?? null,
    nextAlarmAt: null };
}

/** Stop only the persisted immutable target. A failed or ambiguous native
 * retirement leaves its Postgres assignment intact for the existing retry. */
export async function stopPostgresRuntimeForUser(source: RuntimeUserControlSource, userId: string, owner: HostedRuntimeOwnerSnapshot | null) {
  const result = { activeInvocationPreempted: false, runnerContainerDestroyAttempted: false, runnerContainerDestroyOk: true };
  if (!owner) return result;
  if (owner.attemptId) {
    const retired = await commandHostedRuntimeOwner({ source, userId, command: {
      operation: "retire", attemptId: owner.attemptId, generation: owner.generation, completed: false,
    } });
    if (retired.status !== "updated") throw new Error("Runtime changed during user-control retirement.");
    result.activeInvocationPreempted = true;
  }
  if (owner.runnerContainerName) {
    result.runnerContainerDestroyAttempted = true;
    const namespace = createHostedRunnerContainerNamespaceRouter({ exactUser: source.RUNNER_CONTAINER,
      next: source.NEXT_RUNNER_CONTAINER, standby: source.STANDBY_RUNNER_CONTAINER ?? null });
    if (!namespace) throw new Error("Runtime stop adapter is unavailable.");
    const slot = requireHostedRunnerSlotLifecycle(namespace.getByName(owner.runnerContainerName));
    await slot.retireStandbySlot({ ...(owner.allocationId ? { claimId: owner.allocationId } : {}),
      target: { slotName: owner.runnerContainerName, userId } });
    const binding = await slot.readStandbySlotBinding();
    if (binding.state !== "retired" || binding.slotName !== owner.runnerContainerName) throw new Error("Runtime stop was not confirmed.");
    await commandHostedRuntimeOwner({ source, userId, command: { operation: "target_retired", runnerContainerName: owner.runnerContainerName } });
  } else if (owner.attemptId) {
    const released = await commandHostedRuntimeOwner({ source, userId, command: {
      operation: "release", attemptId: owner.attemptId, generation: owner.generation, runnerContainerName: null,
    } });
    if (released.status !== "updated") throw new Error("Runtime allocation retirement was not confirmed.");
  }
  return result;
}

export async function reconcilePostgresRuntimeConsent(source: RuntimeUserControlSource, userId: string) {
  const ownership = await commandHostedRuntimeOwner({ source, userId, command: { operation: "reconcile" } });
  if (ownership.cutover !== "postgres") throw new Error("Runtime consent authority is unavailable.");
  const admission = parseHostedRuntimeHealthDataAdmissionResponse(await readRuntimeControl(source, userId, HOSTED_RUNTIME_HEALTH_DATA_ADMISSION_PATH));
  if (admission.userId !== userId) throw new Error("Runtime consent member mismatch.");
  const stopped = admission.processingAllowed
    ? { activeInvocationPreempted: false, runnerContainerDestroyAttempted: false, runnerContainerDestroyOk: true }
    : await stopPostgresRuntimeForUser(source, userId, ownership.owner);
  return { ...admission, ...stopped };
}

export async function deletePostgresRunnerUserData(source: RuntimeUserControlSource, userId: string) {
  const ownership = await commandHostedRuntimeOwner({ source, userId, command: { operation: "reconcile" } });
  if (ownership.cutover !== "postgres") throw new Error("Runtime deletion authority is unavailable.");
  await stopPostgresRuntimeForUser(source, userId, ownership.owner);
  const admission = await commandHostedRuntimeOwner({ source, userId, command: { operation: "deletion_ready" } });
  if (admission.cutover !== "postgres" || admission.status !== "authorized") {
    return { ok: false as const, reason: "r2_upload_drain_pending" as const, retryAfterSeconds: 1, userId };
  }
  const r2 = await deleteHostedUserR2DataBeforeStateDeletion({ bucket: source.BUNDLES, userId });
  return { ok: true as const, userId, deletedAt: new Date().toISOString(), r2,
    stateOwner: "postgres" as const, runtimeStateCleared: true,
    // The frozen legacy namespace belongs to the finite fleet migration. This
    // operation does not falsely acknowledge deleting its durable storage.
    durableObject: { alarmCleared: false, deleteAllCompleted: false, stateDeleted: false } };
}
