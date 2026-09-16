import { isHostedRuntimeFailurePhaseCode, HOSTED_WORKSPACE_INVOCATION_PROCESSING_MODES, type HostedWorkspaceInvocationProcessingMode } from "./runtime-control.ts";
import { parseAllowedString, readNullableString, requireBoolean, requireNonNegativeBigIntString, requireNonNegativeInteger, requireObject, requireString } from "./parsers/assertions.ts";

export const HOSTED_RUNTIME_OWNER_PATH = "/api/internal/hosted-runtime/owner";
export const HOSTED_RUNTIME_OWNER_PHASES = ["idle", "starting", "active", "retiring"] as const;
export const HOSTED_RUNTIME_CUTOVER_PHASES = ["legacy", "draining", "postgres"] as const;

export interface HostedRuntimeOwnerIdentity {
  attemptId: string;
  generation: string;
}

export interface HostedRuntimeOwnerSnapshot {
  userId: string;
  generation: string;
  attemptId: string | null;
  phase: (typeof HOSTED_RUNTIME_OWNER_PHASES)[number];
  processingMode: HostedWorkspaceInvocationProcessingMode | null;
  allocationId: string | null;
  runnerContainerName: string | null;
  workspaceVersion: string | null;
  customInferenceEnvelope: string | null;
  platformAiUsageAllowed: boolean;
  startedAt: string | null;
  acceptedAt: string | null;
  completedAt: string | null;
  failureCount: number;
  lastErrorCode: string | null;
}

export type HostedRuntimeOwnerCommand =
  | { operation: "reconcile" }
  | { operation: "resolve_legacy"; objectId: string; workerVersion: string }
  | { operation: "deletion_ready" }
  | { operation: "target_retired"; runnerContainerName: string }
  | { operation: "authorize_provider"; runnerContainerName: string | null; providerEgressTokenHash: string | null; providerKind: string }
  | { operation: "claim"; processingMode: HostedWorkspaceInvocationProcessingMode }
  | ({ operation: "select_target"; runnerContainerName: string } & HostedRuntimeOwnerIdentity)
  | ({ operation: "prepare_launch"; runnerContainerName: string; workspaceVersion: string;
      providerEgressTokenHash: string | null; customInferenceEnvelope: string | null;
      platformAiUsageAllowed: boolean; processingMode: HostedWorkspaceInvocationProcessingMode } & HostedRuntimeOwnerIdentity)
  | ({ operation: "accepted" | "revoke_ai_usage" } & HostedRuntimeOwnerIdentity)
  | ({ operation: "record_failure"; errorCode: string } & HostedRuntimeOwnerIdentity)
  | ({ operation: "retire"; completed: boolean } & HostedRuntimeOwnerIdentity)
  | ({ operation: "release"; runnerContainerName: string | null } & HostedRuntimeOwnerIdentity)
  | ({ operation: "release_completed"; runnerContainerName: string } & HostedRuntimeOwnerIdentity)
  | ({ operation: "authorize_effect"; runnerContainerName: string | null; managedAi: boolean } & HostedRuntimeOwnerIdentity);

export interface HostedRuntimeOwnerResponse {
  cutover: (typeof HOSTED_RUNTIME_CUTOVER_PHASES)[number];
  status: "claimed" | "existing" | "blocked" | "updated" | "stale" | "observed" | "authorized";
  owner: HostedRuntimeOwnerSnapshot | null;
}

export function parseHostedRuntimeOwnerCommand(value: unknown): HostedRuntimeOwnerCommand {
  const r = requireObject(value, "Runtime ownership command");
  const operation = requireString(r.operation, "Runtime ownership operation");
  if (operation === "reconcile" || operation === "deletion_ready") return { operation };
  if (operation === "resolve_legacy") {
    const objectId = requireString(r.objectId, "Legacy object identity");
    const workerVersion = requireString(r.workerVersion, "Legacy serving version");
    if (!/^[a-f0-9]{64}$/u.test(objectId) || !/^[A-Za-z0-9_-]{1,128}$/u.test(workerVersion)) throw new TypeError("Legacy materialization identity is invalid.");
    return { operation, objectId, workerVersion };
  }
  if (operation === "target_retired") return { operation, runnerContainerName: requireString(r.runnerContainerName, "Retired target") };
  if (operation === "claim") return { operation, processingMode: parseAllowedString(r.processingMode, "Runtime processing mode", HOSTED_WORKSPACE_INVOCATION_PROCESSING_MODES) };
  if (operation === "authorize_provider") return parseProviderAuthorization(r);
  return parseInvocationCommand(r, operation);
}

function parseProviderAuthorization(r: Record<string, unknown>): HostedRuntimeOwnerCommand {
    const runnerContainerName = readNullableString(r.runnerContainerName, "Runtime target");
    const providerEgressTokenHash = readNullableString(r.providerEgressTokenHash, "Provider token hash");
    if (Boolean(runnerContainerName) === Boolean(providerEgressTokenHash)) throw new TypeError("Provider authorization requires exactly one credential identity.");
    if (providerEgressTokenHash && !/^[a-f0-9]{64}$/u.test(providerEgressTokenHash)) throw new TypeError("Provider token hash is invalid.");
    const providerKind = requireString(r.providerKind, "Provider kind");
    if (!/^[a-z][a-z0-9_]{0,63}$/u.test(providerKind)) throw new TypeError("Provider kind is invalid.");
    return { operation: "authorize_provider", runnerContainerName, providerEgressTokenHash, providerKind };
}

function parseInvocationCommand(r: Record<string, unknown>, operation: string): HostedRuntimeOwnerCommand {
  const identity = parseHostedRuntimeOwnerIdentity(r);
  switch (operation) {
    case "select_target": return { operation, ...identity, runnerContainerName: requireString(r.runnerContainerName, "Runtime target") };
    case "prepare_launch": return {
      operation, ...identity,
      runnerContainerName: requireString(r.runnerContainerName, "Runtime target"),
      workspaceVersion: requireNonNegativeBigIntString(r.workspaceVersion, "Workspace version"),
      providerEgressTokenHash: readNullableString(r.providerEgressTokenHash, "Provider token hash"),
      customInferenceEnvelope: readNullableString(r.customInferenceEnvelope, "Inference envelope"),
      platformAiUsageAllowed: requireBoolean(r.platformAiUsageAllowed, "Managed AI admission"),
      processingMode: parseAllowedString(r.processingMode, "Runtime processing mode", HOSTED_WORKSPACE_INVOCATION_PROCESSING_MODES),
    };
    case "accepted":
    case "revoke_ai_usage": return { operation, ...identity };
    case "record_failure": {
      if (r.errorCode !== "runtime_error" && !isHostedRuntimeFailurePhaseCode(r.errorCode)) throw new TypeError("Unsupported runtime failure code.");
      return { operation, ...identity, errorCode: r.errorCode };
    }
    case "retire": return { operation, ...identity, completed: requireBoolean(r.completed, "Runtime completion") };
    case "release": return { operation, ...identity, runnerContainerName: readNullableString(r.runnerContainerName, "Retired target") };
    case "release_completed": return { operation, ...identity, runnerContainerName: requireString(r.runnerContainerName, "Completed target") };
    case "authorize_effect": {
      const runnerContainerName = readNullableString(r.runnerContainerName, "Runtime target");
      const managedAi = requireBoolean(r.managedAi, "Managed AI effect");
      if (managedAi && !runnerContainerName) throw new TypeError("Managed AI authorization requires a native target.");
      return { operation, ...identity, runnerContainerName, managedAi };
    }
    default: throw new TypeError("Unsupported runtime ownership operation.");
  }
}

export function parseHostedRuntimeOwnerResponse(value: unknown): HostedRuntimeOwnerResponse {
  const r = requireObject(value, "Runtime ownership response");
  const owner = r.owner === null ? null : parseOwner(r.owner);
  return {
    cutover: parseAllowedString(r.cutover, "Runtime cutover phase", HOSTED_RUNTIME_CUTOVER_PHASES),
    status: parseAllowedString(r.status, "Runtime ownership status", ["claimed", "existing", "blocked", "updated", "stale", "observed", "authorized"] as const),
    owner,
  };
}

export function parseHostedRuntimeOwnerIdentity(value: unknown): HostedRuntimeOwnerIdentity {
  const record = requireObject(value, "Runtime identity");
  const attemptId = requireString(record.attemptId, "Runtime attempt");
  const generation = requireNonNegativeBigIntString(record.generation, "Runtime generation");
  if (!/^[A-Za-z0-9._:-]{1,200}$/u.test(attemptId) || BigInt(generation) > 9_223_372_036_854_775_807n) {
    throw new TypeError("Runtime ownership identity is invalid.");
  }
  return { attemptId, generation };
}

function parseOwner(value: unknown): HostedRuntimeOwnerSnapshot {
  const r = requireObject(value, "Runtime owner");
  const owner = {
    userId: requireString(r.userId, "Runtime member"),
    generation: requireNonNegativeBigIntString(r.generation, "Runtime generation"),
    attemptId: readNullableString(r.attemptId, "Runtime attempt"),
    phase: parseAllowedString(r.phase, "Runtime phase", HOSTED_RUNTIME_OWNER_PHASES),
    processingMode: r.processingMode === null ? null : parseAllowedString(r.processingMode, "Runtime processing mode", HOSTED_WORKSPACE_INVOCATION_PROCESSING_MODES),
    allocationId: readNullableString(r.allocationId, "Runtime allocation"),
    runnerContainerName: readNullableString(r.runnerContainerName, "Runtime target"),
    workspaceVersion: r.workspaceVersion === null ? null : requireNonNegativeBigIntString(r.workspaceVersion, "Workspace version"),
    customInferenceEnvelope: readNullableString(r.customInferenceEnvelope, "Inference envelope"),
    platformAiUsageAllowed: requireBoolean(r.platformAiUsageAllowed, "Managed AI admission"),
    startedAt: readNullableString(r.startedAt, "Runtime start"),
    acceptedAt: readNullableString(r.acceptedAt, "Runtime acceptance"),
    completedAt: readNullableString(r.completedAt, "Runtime completion"),
    failureCount: requireNonNegativeInteger(r.failureCount, "Runtime failure count"),
    lastErrorCode: readNullableString(r.lastErrorCode, "Runtime error code"),
  };
  if (owner.phase !== "idle" && (!owner.attemptId || !owner.allocationId || !owner.processingMode)) {
    throw new TypeError("Claimed runtime ownership is incomplete.");
  }
  return owner;
}
