import {
  decodeHostedBundleBase64,
  encodeHostedBundleBase64,
  listHostedBundleArtifacts,
  snapshotHostedExecutionContext,
  type HostedBundleArtifactLocation,
} from "@murphai/runtime-state/node";
import type {
  HostedExecutionDispatchRequest,
  HostedExecutionRunContext,
  HostedExecutionRunnerResult,
} from "@murphai/hosted-execution";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  refreshAssistantStatusSnapshot,
  type AssistantExecutionContext,
} from "@murphai/assistant-engine";
import { assistantGatewayLocalProjectionSourceReader } from "@murphai/assistant-engine/gateway-local-adapter";
import { exportGatewayProjectionSnapshotLocal } from "@murphai/gateway-local";

import { createHostedArtifactUploadSink } from "./artifacts.ts";
import {
  collectHostedAssistantDeliverySideEffects,
  drainHostedCommittedAssistantDeliveriesAfterCommit,
} from "./callbacks.ts";
import { executeHostedDispatchEvent } from "./events.ts";
import { runHostedMaintenanceLoop } from "./maintenance.ts";
import type {
  HostedAssistantRuntimeCompletedJobResult,
  HostedAssistantRuntimeJobRequest,
  HostedCommittedExecutionState,
  HostedRestoredExecutionContext,
  NormalizedHostedAssistantRuntimeConfig,
  HostedWorkspaceArtifactMaterializer,
} from "./models.ts";
import { summarizeDispatch } from "./summary.ts";
import { exportHostedPendingAssistantUsage } from "./usage.ts";

export async function executeHostedDispatchForCommit(input: {
  artifactMaterializer?: HostedWorkspaceArtifactMaterializer | null;
  executionContext: AssistantExecutionContext;
  materializedArtifactPaths?: ReadonlySet<string>;
  request: HostedAssistantRuntimeJobRequest;
  restored: HostedRestoredExecutionContext;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "platform" | "resolvedConfig" | "userEnv"
  >;
  runtimeEnv: Readonly<Record<string, string>>;
}): Promise<HostedCommittedExecutionState> {
  emitHostedExecutionStructuredLog({
    component: "runtime",
    dispatch: input.request.dispatch,
    details: {
      runElapsedMs: computeHostedRunElapsedMs(input.request.run ?? null),
    },
    message: "Hosted runtime executing dispatch handlers.",
    phase: "dispatch.running",
    run: input.request.run ?? null,
  });
  const dispatchHandlersStartedAtMs = Date.now();
  const dispatchMetrics = await executeHostedDispatchEvent({
    dispatch: input.request.dispatch,
    runtime: input.runtime,
    runtimeEnv: input.runtimeEnv,
    sharePack: input.request.sharePack ?? null,
    vaultRoot: input.restored.vaultRoot,
  });
  emitHostedExecutionStructuredLog({
    component: "runtime",
    dispatch: input.request.dispatch,
    details: {
      dispatchHandlerLatencyMs: Date.now() - dispatchHandlersStartedAtMs,
      runElapsedMs: computeHostedRunElapsedMs(input.request.run ?? null),
    },
    message: "Hosted runtime finished dispatch handlers.",
    phase: "dispatch.running",
    run: input.request.run ?? null,
  });
  const maintenanceStartedAtMs = Date.now();
  const maintenanceMetrics = await runHostedMaintenanceLoop({
    artifactMaterializer: input.artifactMaterializer ?? null,
    deviceSyncPort: input.runtime.platform.deviceSyncPort,
    dispatch: input.request.dispatch,
    executionContext: input.executionContext,
    requestId: input.request.dispatch.eventId,
    resolvedConfig: input.runtime.resolvedConfig,
    skipAssistantAutomation: input.request.dispatch.event.kind === "member.activated"
      && dispatchMetrics.bootstrapResult?.assistantConfigured === false,
    timeoutMs: input.runtime.commitTimeoutMs,
    vaultRoot: input.restored.vaultRoot,
  });
  emitHostedExecutionStructuredLog({
    component: "runtime",
    dispatch: input.request.dispatch,
    details: {
      maintenanceLatencyMs: Date.now() - maintenanceStartedAtMs,
      nextWakeAt: maintenanceMetrics.nextWakeAt,
      runElapsedMs: computeHostedRunElapsedMs(input.request.run ?? null),
    },
    message: "Hosted runtime finished maintenance loop.",
    phase: "dispatch.running",
    run: input.request.run ?? null,
  });
  const snapshotStartedAtMs = Date.now();
  const committedSnapshot = await snapshotHostedExecutionContext({
    artifactSink: createHostedArtifactUploadSink({
      artifactStore: input.runtime.platform.artifactStore,
      knownArtifactHashes: collectHostedBundleArtifactHashes(
        decodeHostedBundleBase64(input.request.bundle),
      ),
    }),
    operatorHomeRoot: input.restored.operatorHomeRoot,
    preservedArtifacts: collectPreservedHostedArtifacts({
      bytes: decodeHostedBundleBase64(input.request.bundle),
      materializedArtifactPaths: input.materializedArtifactPaths ?? new Set(),
    }),
    vaultRoot: input.restored.vaultRoot,
  });
  emitHostedExecutionStructuredLog({
    component: "runtime",
    dispatch: input.request.dispatch,
    details: {
      runElapsedMs: computeHostedRunElapsedMs(input.request.run ?? null),
      snapshotLatencyMs: Date.now() - snapshotStartedAtMs,
    },
    message: "Hosted runtime snapshotted execution context.",
    phase: "commit.recorded",
    run: input.request.run ?? null,
  });
  const committedAssistantDeliveryEffects = await collectHostedAssistantDeliverySideEffects(
    input.restored.vaultRoot,
  );
  const committedGatewayProjectionSnapshot = await exportGatewayProjectionSnapshotLocal(
    input.restored.vaultRoot,
    {
      sourceReader: assistantGatewayLocalProjectionSourceReader,
    },
  );

  return {
    committedGatewayProjectionSnapshot,
    committedResult: {
      bundle: encodeHostedBundleBase64(committedSnapshot.bundle),
      result: {
        eventsHandled: 1,
        nextWakeAt: maintenanceMetrics.nextWakeAt,
        summary: summarizeDispatch(input.request.dispatch, {
          ...dispatchMetrics,
          ...maintenanceMetrics,
        }),
      },
    },
    committedAssistantDeliveryEffects,
  };
}

export async function completeHostedExecutionAfterCommit(input: {
  dispatch: HostedExecutionDispatchRequest;
  materializedArtifactPaths?: ReadonlySet<string>;
  run?: HostedExecutionRunContext | null;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "platform" | "resolvedConfig" | "userEnv"
  >;
  restored: HostedRestoredExecutionContext;
  committedExecution: HostedCommittedExecutionState;
}): Promise<HostedAssistantRuntimeCompletedJobResult> {
  emitHostedExecutionStructuredLog({
    component: "runtime",
    dispatch: input.dispatch,
    details: {
      runElapsedMs: computeHostedRunElapsedMs(input.run ?? null),
    },
    message: "Hosted runtime draining committed side effects.",
    phase: "side-effects.draining",
    run: input.run ?? null,
  });
  const sideEffectsStartedAtMs = Date.now();
  await drainHostedCommittedAssistantDeliveriesAfterCommit({
    dispatch: input.dispatch,
    effectsPort: input.runtime.platform.effectsPort,
    assistantDeliveryEffects: input.committedExecution.committedAssistantDeliveryEffects,
    vaultRoot: input.restored.vaultRoot,
  });
  await exportHostedPendingAssistantUsage({
    usageExportPort: input.runtime.platform.usageExportPort,
    vaultRoot: input.restored.vaultRoot,
  });
  await refreshAssistantStatusSnapshot(input.restored.vaultRoot);
  emitHostedExecutionStructuredLog({
    component: "runtime",
    dispatch: input.dispatch,
    details: {
      runElapsedMs: computeHostedRunElapsedMs(input.run ?? null),
      sideEffectsDrainLatencyMs: Date.now() - sideEffectsStartedAtMs,
    },
    message: "Hosted runtime drained committed side effects.",
    phase: "side-effects.draining",
    run: input.run ?? null,
  });

  const finalSnapshotStartedAtMs = Date.now();
  const finalSnapshot = await snapshotHostedExecutionContext({
    artifactSink: createHostedArtifactUploadSink({
      artifactStore: input.runtime.platform.artifactStore,
      knownArtifactHashes: collectHostedBundleArtifactHashes(
        decodeHostedBundleBase64(input.committedExecution.committedResult.bundle),
      ),
    }),
    operatorHomeRoot: input.restored.operatorHomeRoot,
    preservedArtifacts: collectPreservedHostedArtifacts({
      bytes: decodeHostedBundleBase64(input.committedExecution.committedResult.bundle),
      materializedArtifactPaths: input.materializedArtifactPaths ?? new Set(),
    }),
    vaultRoot: input.restored.vaultRoot,
  });
  emitHostedExecutionStructuredLog({
    component: "runtime",
    dispatch: input.dispatch,
    details: {
      finalSnapshotLatencyMs: Date.now() - finalSnapshotStartedAtMs,
      runElapsedMs: computeHostedRunElapsedMs(input.run ?? null),
    },
    message: "Hosted runtime snapshotted final execution state.",
    phase: "completed",
    run: input.run ?? null,
  });
  const finalGatewayProjectionSnapshot = await exportGatewayProjectionSnapshotLocal(
    input.restored.vaultRoot,
    {
      sourceReader: assistantGatewayLocalProjectionSourceReader,
    },
  );
  const finalResult: HostedExecutionRunnerResult = {
    bundle: encodeHostedBundleBase64(finalSnapshot.bundle),
    result: input.committedExecution.committedResult.result,
  };

  return {
    finalGatewayProjectionSnapshot,
    phase: "completed",
    result: finalResult,
  };
}

function collectHostedBundleArtifactHashes(bytes: Uint8Array | null): Set<string> {
  if (!bytes) {
    return new Set();
  }

  try {
    return new Set(
      listHostedBundleArtifacts({
        bytes,
        expectedKind: "vault",
      }).map((artifact) => artifact.ref.sha256),
    );
  } catch {
    return new Set();
  }
}

function collectPreservedHostedArtifacts(input: {
  bytes: Uint8Array | null;
  materializedArtifactPaths: ReadonlySet<string>;
}): HostedBundleArtifactLocation[] {
  if (!input.bytes) {
    return [];
  }

  try {
    return listHostedBundleArtifacts({
      bytes: input.bytes,
      expectedKind: "vault",
    }).filter((artifact) => !input.materializedArtifactPaths.has(artifact.path));
  } catch {
    return [];
  }
}

function computeHostedRunElapsedMs(
  run: HostedAssistantRuntimeJobRequest["run"] | null | undefined,
): number | null {
  if (!run?.startedAt) {
    return null;
  }

  const startedAtMs = Date.parse(run.startedAt);
  if (!Number.isFinite(startedAtMs)) {
    return null;
  }

  return Math.max(0, Date.now() - startedAtMs);
}
