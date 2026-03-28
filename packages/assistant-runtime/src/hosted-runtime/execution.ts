import {
  decodeHostedBundleBase64,
  encodeHostedBundleBase64,
  listHostedBundleArtifacts,
  snapshotHostedExecutionContext,
} from "@murph/runtime-state";
import type {
  HostedExecutionDispatchRequest,
  HostedExecutionRunnerResult,
} from "@murph/hosted-execution";
import {
  refreshAssistantStatusSnapshot,
} from "@murph/assistant-services/status";

import { reconcileHostedVerifiedEmailSelfTarget } from "../hosted-email-route.ts";
import { createHostedArtifactUploadSink } from "./artifacts.ts";
import {
  collectHostedExecutionSideEffects,
  drainHostedCommittedSideEffectsAfterCommit,
  finalizeHostedExecutionResult,
} from "./callbacks.ts";
import { executeHostedDispatchEvent } from "./events.ts";
import { runHostedMaintenanceLoop } from "./maintenance.ts";
import type {
  HostedAssistantRuntimeJobRequest,
  HostedCommittedExecutionState,
  HostedExecutionCommitCallback,
  HostedRestoredExecutionContext,
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";
import { summarizeDispatch } from "./summary.ts";

export async function executeHostedDispatchForCommit(input: {
  request: HostedAssistantRuntimeJobRequest;
  restored: HostedRestoredExecutionContext;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "artifactsBaseUrl" | "commitTimeoutMs" | "emailBaseUrl" | "sharePackBaseUrl" | "sharePackToken"
  >;
  runtimeEnv: Readonly<Record<string, string>>;
}): Promise<HostedCommittedExecutionState> {
  const dispatchMetrics = await executeHostedDispatchEvent({
    dispatch: input.request.dispatch,
    emailBaseUrl: input.runtime.emailBaseUrl,
    runtime: input.runtime,
    runtimeEnv: input.runtimeEnv,
    vaultRoot: input.restored.vaultRoot,
  });
  const maintenanceMetrics = await runHostedMaintenanceLoop({
    dispatch: input.request.dispatch,
    requestId: input.request.dispatch.eventId,
    runtimeEnv: input.runtimeEnv,
    vaultRoot: input.restored.vaultRoot,
  });
  const committedSnapshot = await snapshotHostedExecutionContext({
    artifactSink: createHostedArtifactUploadSink({
      artifactsBaseUrl: input.runtime.artifactsBaseUrl,
      knownArtifactHashes: collectHostedBundleArtifactHashes(
        decodeHostedBundleBase64(input.request.bundles.vault),
      ),
      timeoutMs: input.runtime.commitTimeoutMs,
    }),
    operatorHomeRoot: input.restored.operatorHomeRoot,
    vaultRoot: input.restored.vaultRoot,
  });
  const committedSideEffects = await collectHostedExecutionSideEffects(input.restored.vaultRoot);

  return {
    committedResult: {
      bundles: {
        agentState: encodeHostedBundleBase64(committedSnapshot.agentStateBundle),
        vault: encodeHostedBundleBase64(committedSnapshot.vaultBundle),
      },
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
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "artifactsBaseUrl" | "commitBaseUrl" | "commitTimeoutMs" | "emailBaseUrl" | "sideEffectsBaseUrl" | "userEnv"
  >;
  restored: HostedRestoredExecutionContext;
  committedExecution: HostedCommittedExecutionState;
}): Promise<HostedExecutionRunnerResult> {
  await drainHostedCommittedSideEffectsAfterCommit({
    commit: input.commit,
    commitTimeoutMs: input.runtime.commitTimeoutMs,
    dispatch: input.dispatch,
    emailBaseUrl: input.runtime.emailBaseUrl,
    sideEffectsBaseUrl: input.runtime.sideEffectsBaseUrl,
    sideEffects: input.committedExecution.committedSideEffects,
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
      knownArtifactHashes: collectHostedBundleArtifactHashes(
        decodeHostedBundleBase64(input.committedExecution.committedResult.bundles.vault),
      ),
      timeoutMs: input.runtime.commitTimeoutMs,
    }),
    operatorHomeRoot: input.restored.operatorHomeRoot,
    vaultRoot: input.restored.vaultRoot,
  });
  const finalResult: HostedExecutionRunnerResult = {
    bundles: {
      agentState: encodeHostedBundleBase64(finalSnapshot.agentStateBundle),
      vault: encodeHostedBundleBase64(finalSnapshot.vaultBundle),
    },
    result: input.committedExecution.committedResult.result,
  };

  await finalizeHostedExecutionResult({
    commit: input.commit,
    committedResult: input.committedExecution.committedResult,
    dispatch: input.dispatch,
    finalResult,
    runtime: input.runtime,
  });

  return finalResult;
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
