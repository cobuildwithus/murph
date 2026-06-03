import {
  runHostedWorkspaceRuntimeJobInProcess,
  type HostedAssistantRuntimeConfig,
  type HostedAssistantWorkspaceRuntimeJobInput,
  type HostedAssistantWorkspaceRuntimeJobResult,
  type RuntimeWakeSignal,
} from "./hosted-runtime.ts";
export {
  stopHostedCliRuntimeBridge,
} from "./hosted-runtime/cli-runtime-bridge.ts";
import type {
  HostedRuntimePlatform,
} from "./hosted-runtime/platform.ts";
import {
  createHostedRuntimeBridgeLeaseFromWorkspaceRequest,
  createHostedWorkspaceRuntimeBridgeJobOptions,
  type HostedWorkspaceMailboxPayloadDecoder,
  type HostedWorkspaceSnapshotArchiveBuilder,
} from "./hosted-runtime/snapshot-bridge.ts";
import type {
  HostedRuntimeBridgeCheckpointLease,
} from "./hosted-checkpoint-bridge.ts";
export type {
  HostedRuntimeBridgeCheckpointLease,
} from "./hosted-checkpoint-bridge.ts";

export type {
  HostedWorkspaceMailboxPayloadDecoder,
  HostedWorkspaceSnapshotArchiveBuilder,
} from "./hosted-runtime/snapshot-bridge.ts";

export interface HostedWorkspaceInvocationInput {
  job: HostedAssistantWorkspaceRuntimeJobInput;
  mailboxPayloadDecoder: HostedWorkspaceMailboxPayloadDecoder;
  platform: HostedRuntimePlatform;
  readCurrentLease: () =>
    | HostedRuntimeBridgeCheckpointLease
    | null
    | Promise<HostedRuntimeBridgeCheckpointLease | null>;
  runtimeWakeSignal: RuntimeWakeSignal;
  signal?: AbortSignal | null;
  snapshotArchiveBuilder: HostedWorkspaceSnapshotArchiveBuilder;
  snapshotDiagnosticsHashSecret?: string | null;
  vaultRoot: string;
}

export async function runHostedWorkspaceInvocation(
  input: HostedWorkspaceInvocationInput,
): Promise<HostedAssistantWorkspaceRuntimeJobResult> {
  const readCurrentLease = requireHostedInvocationReadCurrentLease(input.readCurrentLease);
  const runtimeWakeSignal = requireHostedInvocationRuntimeWakeSignal(input.runtimeWakeSignal);
  const runtime: HostedAssistantRuntimeConfig = input.job.runtime ?? {};
  const options = createHostedWorkspaceRuntimeBridgeJobOptions({
    consumePendingRuntimeWake: () => runtimeWakeSignal.consumePending(),
    decodeMailboxPayload: input.mailboxPayloadDecoder,
    platform: input.platform,
    readCurrentLease,
    request: input.job.request,
    runtime,
    snapshotArchiveBuilder: input.snapshotArchiveBuilder,
    snapshotDiagnosticsHashSecret: input.snapshotDiagnosticsHashSecret ?? null,
    vaultRoot: input.vaultRoot,
  });

  return await runHostedWorkspaceRuntimeJobInProcess(input.job, {
    ...options,
    runtimeWakeSignal,
    signal: input.signal ?? null,
  });
}

export function createHostedWorkspaceInvocationLease(
  input: HostedAssistantWorkspaceRuntimeJobInput,
): HostedRuntimeBridgeCheckpointLease {
  return createHostedRuntimeBridgeLeaseFromWorkspaceRequest(input.request);
}

function requireHostedInvocationReadCurrentLease(
  value: HostedWorkspaceInvocationInput["readCurrentLease"] | null | undefined,
): HostedWorkspaceInvocationInput["readCurrentLease"] {
  if (typeof value !== "function") {
    throw new TypeError("runHostedWorkspaceInvocation requires readCurrentLease.");
  }

  return value;
}

function requireHostedInvocationRuntimeWakeSignal(
  value: RuntimeWakeSignal | null | undefined,
): RuntimeWakeSignal {
  if (
    !value
    || typeof value.consumePending !== "function"
    || typeof value.notify !== "function"
    || typeof value.wait !== "function"
  ) {
    throw new TypeError("runHostedWorkspaceInvocation requires runtimeWakeSignal.");
  }

  return value;
}
