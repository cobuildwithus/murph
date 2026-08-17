import type {
  HostedRuntimeLatencyTraceStagedMilestones,
} from "@murphai/hosted-execution/runtime-control";

import {
  runHostedWorkspaceRuntimeJobInProcess,
  type HostedAssistantRuntimeConfig,
  type HostedAssistantWorkspaceRuntimeJobInput,
  type HostedAssistantWorkspaceRuntimeJobResult,
  type RuntimeWakeSignal,
} from "./hosted-runtime.ts";
export { drainHostedRuntimeDeferredUsageCompletionsBestEffort } from "./hosted-runtime.ts";
import type {
  HostedRuntimePlatform,
} from "./hosted-runtime/platform.ts";
import {
  drainHostedRuntimeLogWritesBestEffort,
} from "./hosted-runtime/runtime-logs.ts";
import {
  drainHostedAssistantDeliveryControlPlaneWritesBestEffort,
} from "./hosted-runtime/callbacks.ts";
// Re-exported so the container entrypoint's process-fatal handler can flush
// queued diagnostics (bounded by its exit backstop) before the process dies.
export { drainHostedRuntimeLogWritesBestEffort } from "./hosted-runtime/runtime-logs.ts";
export {
  drainHostedAssistantDeliveryControlPlaneWritesBestEffort,
} from "./hosted-runtime/callbacks.ts";
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
  latencyMilestones?: HostedRuntimeLatencyTraceStagedMilestones | null;
  mailboxPayloadDecoder: HostedWorkspaceMailboxPayloadDecoder;
  onConversationActivityObserved?: () => void;
  platform: HostedRuntimePlatform;
  readCurrentLease: () =>
    | HostedRuntimeBridgeCheckpointLease
    | null
    | Promise<HostedRuntimeBridgeCheckpointLease | null>;
  runtimeWakeSignal: RuntimeWakeSignal;
  shutdownSignal?: AbortSignal | null;
  signal?: AbortSignal | null;
  snapshotArchiveBuilder: HostedWorkspaceSnapshotArchiveBuilder;
  snapshotDiagnosticsHashSecret?: string | null;
  vaultRoot: string;
  waitForBackgroundAssistantWork(signal: AbortSignal | null): Promise<void>;
}

export async function runHostedWorkspaceInvocation(
  input: HostedWorkspaceInvocationInput,
): Promise<HostedAssistantWorkspaceRuntimeJobResult> {
  const readCurrentLease = requireHostedInvocationReadCurrentLease(input.readCurrentLease);
  const runtimeWakeSignal = requireHostedInvocationRuntimeWakeSignal(input.runtimeWakeSignal);
  const runtime: HostedAssistantRuntimeConfig = input.job.runtime ?? {};
  const options = createHostedWorkspaceRuntimeBridgeJobOptions({
    decodeMailboxPayload: input.mailboxPayloadDecoder,
    platform: input.platform,
    readCurrentLease,
    request: input.job.request,
    runtime,
    snapshotArchiveBuilder: input.snapshotArchiveBuilder,
    snapshotDiagnosticsHashSecret: input.snapshotDiagnosticsHashSecret ?? null,
    vaultRoot: input.vaultRoot,
    waitForBackgroundAssistantWork: input.waitForBackgroundAssistantWork,
  });

  try {
    return await runHostedWorkspaceRuntimeJobInProcess(input.job, {
      ...options,
      latencyMilestones: input.latencyMilestones ?? null,
      onConversationActivityObserved: input.onConversationActivityObserved
        ? () => input.onConversationActivityObserved?.()
        : undefined,
      runtimeWakeSignal,
      shutdownSignal: input.shutdownSignal ?? null,
      signal: input.signal ?? null,
    });
  } finally {
    await drainHostedAssistantDeliveryControlPlaneWritesBestEffort({
      timeoutMs: 2_000,
    });
    // Info-level runtime log writes are queued off the reply hot path; flush
    // them before the invocation result commits so a normal container stop
    // never drops queued diagnostics. Bounded so a degraded log endpoint
    // cannot delay result commit / checkpoint / next-wake handoff; on timeout
    // the remaining writes keep flushing in the background while the warm
    // container lives on.
    await drainHostedRuntimeLogWritesBestEffort({ timeoutMs: 2_000 });
  }
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
