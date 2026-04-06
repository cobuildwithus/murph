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
} from "@murphai/assistant-core";
import type { AssistantExecutionContext } from "@murphai/assistant-core";
import { assistantGatewayLocalProjectionSourceReader } from "@murphai/assistant-core/gateway-local-adapter";
import { exportGatewayProjectionSnapshotLocal } from "@murphai/gateway-local";

import { reconcileHostedVerifiedEmailSelfTarget } from "../hosted-email-route.ts";
import { createHostedArtifactUploadSink } from "./artifacts.ts";
import {
  collectHostedExecutionSideEffects,
  drainHostedCommittedSideEffectsAfterCommit,
} from "./callbacks.ts";
import { executeHostedDispatchEvent } from "./events.ts";
import { runHostedMaintenanceLoop } from "./maintenance.ts";
import type {
  HostedAssistantRuntimeJobResult,
  HostedAssistantRuntimeJobRequest,
  HostedCommittedExecutionState,
  HostedExecutionCommitCallback,
  HostedRestoredExecutionContext,
  NormalizedHostedAssistantRuntimeConfig,
  HostedWorkspaceArtifactMaterializer,
} from "./models.ts";
import { summarizeDispatch } from "./summary.ts";
import { exportHostedPendingAssistantUsage } from "./usage.ts";

export async function executeHostedDispatchForCommit(input: {
  artifactMaterializer?: HostedWorkspaceArtifactMaterializer | null;
  executionContext: AssistantExecutionContext;
  internalWorkerFetch?: typeof fetch;
  materializedArtifactPaths?: ReadonlySet<string>;
  request: HostedAssistantRuntimeJobRequest;
  restored: HostedRestoredExecutionContext;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "artifactsBaseUrl" | "commitTimeoutMs" | "resultsBaseUrl" | "userEnv" | "webControlPlane"
  >;
  runtimeEnv: Readonly<Record<string, string>>;
}): Promise<HostedCommittedExecutionState> {
  emitHostedExecutionStructuredLog({
    component: "runtime",
    dispatch: input.request.dispatch,
    message: "Hosted runtime executing dispatch handlers.",
    phase: "dispatch.running",
    run: input.request.run ?? null,
  });
  const dispatchMetrics = await executeHostedDispatchEvent({
    dispatch: input.request.dispatch,
    resultsBaseUrl: input.runtime.resultsBaseUrl,
    internalWorkerFetch: input.internalWorkerFetch,
    runtime: input.runtime,
    runtimeEnv: input.runtimeEnv,
    vaultRoot: input.restored.vaultRoot,
  });
  const maintenanceMetrics = await runHostedMaintenanceLoop({
    artifactMaterializer: input.artifactMaterializer ?? null,
    dispatch: input.request.dispatch,
    executionContext: input.executionContext,
    internalWorkerFetch: input.internalWorkerFetch,
    requestId: input.request.dispatch.eventId,
    skipAssistantAutomation: input.request.dispatch.event.kind === "member.activated"
      && dispatchMetrics.bootstrapResult?.assistantConfigured === false,
    timeoutMs: input.runtime.commitTimeoutMs,
    runtimeEnv: input.runtimeEnv,
    webControlPlane: input.runtime.webControlPlane,
    vaultRoot: input.restored.vaultRoot,
  });
  const committedSnapshot = await snapshotHostedExecutionContext({
    artifactSink: createHostedArtifactUploadSink({
      artifactsBaseUrl: input.runtime.artifactsBaseUrl,
      fetchImpl: input.internalWorkerFetch,
      knownArtifactHashes: collectHostedBundleArtifactHashes(
        decodeHostedBundleBase64(input.request.bundle),
      ),
      timeoutMs: input.runtime.commitTimeoutMs,
    }),
    operatorHomeRoot: input.restored.operatorHomeRoot,
    preservedArtifacts: collectPreservedHostedArtifacts({
      bytes: decodeHostedBundleBase64(input.request.bundle),
      materializedArtifactPaths: input.materializedArtifactPaths ?? new Set(),
    }),
    vaultRoot: input.restored.vaultRoot,
  });
  const committedSideEffects = await collectHostedExecutionSideEffects(input.restored.vaultRoot);
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
    committedSideEffects,
  };
}

export async function completeHostedExecutionAfterCommit(input: {
  commit: HostedExecutionCommitCallback | null;
  dispatch: HostedExecutionDispatchRequest;
  internalWorkerFetch?: typeof fetch;
  materializedArtifactPaths?: ReadonlySet<string>;
  run?: HostedExecutionRunContext | null;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "artifactsBaseUrl" | "commitTimeoutMs" | "resultsBaseUrl" | "userEnv" | "webControlPlane"
  >;
  restored: HostedRestoredExecutionContext;
  committedExecution: HostedCommittedExecutionState;
}): Promise<HostedAssistantRuntimeJobResult> {
  emitHostedExecutionStructuredLog({
    component: "runtime",
    dispatch: input.dispatch,
    message: "Hosted runtime draining committed side effects.",
    phase: "side-effects.draining",
    run: input.run ?? null,
  });
  await drainHostedCommittedSideEffectsAfterCommit({
    commit: input.commit,
    commitTimeoutMs: input.runtime.commitTimeoutMs,
    dispatch: input.dispatch,
    resultsBaseUrl: input.runtime.resultsBaseUrl,
    fetchImpl: input.internalWorkerFetch,
    sideEffects: input.committedExecution.committedSideEffects,
    vaultRoot: input.restored.vaultRoot,
  });
  await exportHostedPendingAssistantUsage({
    baseUrl: input.runtime.webControlPlane.usageBaseUrl,
    fetchImpl: input.internalWorkerFetch,
    timeoutMs: input.runtime.commitTimeoutMs,
    userId: input.dispatch.event.userId,
    vaultRoot: input.restored.vaultRoot,
  });
  await reconcileHostedVerifiedEmailSelfTarget({
    operatorHomeRoot: input.restored.operatorHomeRoot,
    source: input.runtime.userEnv,
    vaultRoot: input.restored.vaultRoot,
  });
  await refreshAssistantStatusSnapshot(input.restored.vaultRoot);

  const finalSnapshot = await snapshotHostedExecutionContext({
    artifactSink: createHostedArtifactUploadSink({
      artifactsBaseUrl: input.runtime.artifactsBaseUrl,
      fetchImpl: input.internalWorkerFetch,
      knownArtifactHashes: collectHostedBundleArtifactHashes(
        decodeHostedBundleBase64(input.committedExecution.committedResult.bundle),
      ),
      timeoutMs: input.runtime.commitTimeoutMs,
    }),
    operatorHomeRoot: input.restored.operatorHomeRoot,
    preservedArtifacts: collectPreservedHostedArtifacts({
      bytes: decodeHostedBundleBase64(input.committedExecution.committedResult.bundle),
      materializedArtifactPaths: input.materializedArtifactPaths ?? new Set(),
    }),
    vaultRoot: input.restored.vaultRoot,
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
