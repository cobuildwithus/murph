import {
  runHostedWorkspaceRuntimeJobInProcess,
  type HostedAssistantRuntimeConfig,
  type HostedAssistantWorkspaceRuntimeJobInput,
  type HostedAssistantWorkspaceRuntimeJobResult,
  type HostedWorkspaceRuntimeJobOptions,
  type RuntimeWakeSignal,
} from "./hosted-runtime.ts";
import {
  createHostedRuntimeBridgeLeaseFromWorkspaceRequest,
  createHostedWorkspaceRuntimeBridgeJobOptions,
  type HostedRuntimeBridgeReadCurrentLease,
  type HostedWorkspaceMailboxPayloadDecoder,
  type HostedWorkspaceSnapshotArchiveBuilder,
} from "./hosted-runtime/snapshot-bridge.ts";
import type {
  HostedRuntimeBridgeCheckpointLease,
} from "./hosted-runtime/checkpoint-bridge.ts";

export {
  createHostedRuntimeBridgeLeaseFromWorkspaceRequest,
  createHostedWorkspaceRuntimeBridgeJobOptions,
} from "./hosted-runtime/snapshot-bridge.ts";
export type {
  HostedMailboxPayloadDecodeInput,
  HostedMailboxPayloadDecodeItemRef,
  HostedMailboxPayloadDecodeResult,
  HostedRuntimeBridgeReadCurrentLease,
  HostedWorkspaceMailboxPayloadDecodeInput,
  HostedWorkspaceMailboxPayloadDecodeResult,
  HostedWorkspaceMailboxPayloadDecoder,
  HostedWorkspaceRuntimeBridgeOptionsInput,
  HostedWorkspaceSnapshotArchiveBuilder,
} from "./hosted-runtime/snapshot-bridge.ts";
export type {
  HostedRuntimeBridgeBundleWriteContext,
  HostedRuntimeBridgeCheckpointContext,
  HostedRuntimeBridgeCheckpointLease,
  HostedRuntimeBridgeCheckpointLeaseErrorCode,
  HostedRuntimeBridgeCheckpointLeaseStage,
} from "./hosted-runtime/checkpoint-bridge.ts";
export {
  HostedRuntimeBridgeCheckpointLeaseError,
  checkpointHostedRuntimeBridgeWorkspace,
  checkpointHostedRuntimeBridgeWebWorkspace,
  snapshotHostedRuntimeBridgeWorkspaceBundle,
} from "./hosted-runtime/checkpoint-bridge.ts";

export interface HostedWorkspaceInvocationInput {
  job: HostedAssistantWorkspaceRuntimeJobInput;
  mailboxPayloadDecoder: HostedWorkspaceMailboxPayloadDecoder;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  readCurrentLease?: HostedRuntimeBridgeReadCurrentLease;
  runtimeWakeSignal?: RuntimeWakeSignal | null;
  signal?: AbortSignal | null;
  snapshotArchiveBuilder: HostedWorkspaceSnapshotArchiveBuilder;
  snapshotDiagnosticsHashSecret?: string | null;
  vaultRoot: string;
}

export async function runHostedWorkspaceInvocation(
  input: HostedWorkspaceInvocationInput,
): Promise<HostedAssistantWorkspaceRuntimeJobResult> {
  const runtime: HostedAssistantRuntimeConfig = input.job.runtime ?? {};
  const readCurrentLease = input.readCurrentLease
    ?? (() => createHostedRuntimeBridgeLeaseFromWorkspaceRequest(input.job.request));
  const options = createHostedWorkspaceRuntimeBridgeJobOptions({
    consumePendingRuntimeWake: () => input.runtimeWakeSignal?.consumePending() === true,
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
    runtimeWakeSignal: input.runtimeWakeSignal ?? null,
    signal: input.signal ?? null,
  });
}

export function createHostedWorkspaceInvocationLease(
  input: HostedAssistantWorkspaceRuntimeJobInput,
): HostedRuntimeBridgeCheckpointLease {
  return createHostedRuntimeBridgeLeaseFromWorkspaceRequest(input.request);
}
