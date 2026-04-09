import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  decodeHostedBundleBase64,
  restoreHostedExecutionContext,
} from "@murphai/runtime-state/node";
import type {
  HostedExecutionRunnerResult,
} from "@murphai/hosted-execution";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  HostedAssistantConfigurationError,
} from "@murphai/operator-config/hosted-assistant-config";
import type { AssistantExecutionContext } from "@murphai/assistant-engine";

import {
  commitHostedExecutionResult,
  resumeHostedCommittedExecution,
} from "./hosted-runtime/callbacks.ts";
import {
  createHostedArtifactMaterializer,
  createHostedArtifactResolver,
} from "./hosted-runtime/artifacts.ts";
import {
  normalizeHostedAssistantRuntimeConfig,
  withHostedProcessEnvironment,
} from "./hosted-runtime/environment.ts";
import {
  completeHostedExecutionAfterCommit,
  executeHostedDispatchForCommit,
} from "./hosted-runtime/execution.ts";
import {
  startHostedDispatchTypingIndicator,
  stopHostedDispatchTypingIndicator,
} from "./hosted-runtime/typing.ts";
import type {
  HostedAssistantRuntimeJobResult,
  HostedAssistantRuntimeJobInput,
} from "./hosted-runtime/models.ts";
import type {
  HostedRuntimePlatform,
} from "./hosted-runtime/platform.ts";
export {
  formatHostedRuntimeChildResult,
  parseHostedRuntimeChildResult,
} from "./hosted-runtime/child-result.ts";

export type {
  HostedAssistantRuntimeConfig,
  HostedAssistantRuntimeJobInput,
  HostedAssistantRuntimeJobResult,
  HostedAssistantRuntimeJobRequest,
  HostedExecutionCommitCallback,
} from "./hosted-runtime/models.ts";
export type {
  HostedRuntimeArtifactStore,
  HostedRuntimeDeviceSyncPort,
  HostedRuntimeEffectsPort,
  HostedRuntimePlatform,
  HostedRuntimeUsageExportPort,
} from "./hosted-runtime/platform.ts";
export {
  createHostedRuntimeChildLauncherDirectories,
  createHostedRuntimeChildProcessEnv,
  resolveHostedRuntimeTsconfigPath,
  resolveHostedRuntimeTsxImportSpecifier,
} from "./hosted-runtime/environment.ts";
export {
  readHostedRunnerCommitTimeoutMs,
} from "./hosted-runtime/timeouts.ts";
export {
  parseHostedAssistantRuntimeConfig,
  parseHostedAssistantRuntimeJobInput,
  parseHostedAssistantRuntimeJobRequest,
} from "./hosted-runtime/parsers.ts";

export async function runHostedAssistantRuntimeJobInProcess(
  input: HostedAssistantRuntimeJobInput,
  options: {
    platform: HostedRuntimePlatform;
  },
): Promise<HostedExecutionRunnerResult> {
  return (await runHostedAssistantRuntimeJobInProcessDetailed(input, options)).result;
}

export async function runHostedAssistantRuntimeJobInProcessDetailed(
  input: HostedAssistantRuntimeJobInput,
  options: {
    platform: HostedRuntimePlatform;
  },
): Promise<HostedAssistantRuntimeJobResult> {
  emitHostedExecutionStructuredLog({
    component: "runtime",
    dispatch: input.request.dispatch,
    message: "Hosted runtime starting.",
    phase: "runtime.starting",
    run: input.request.run ?? null,
  });
  const runtime = normalizeHostedAssistantRuntimeConfig(input.runtime, options.platform);
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-"));

  try {
    const incomingBundle = decodeHostedBundleBase64(input.request.bundle);
    const artifactResolver = createHostedArtifactResolver({
      artifactStore: runtime.platform.artifactStore,
    });
    const materializedArtifactPaths = new Set<string>();
    const restored = await restoreHostedExecutionContext({
      artifactResolver,
      bundle: incomingBundle,
      shouldRestoreArtifact: () => false,
      workspaceRoot,
    });
    const runtimeEnv = {
      ...runtime.forwardedEnv,
      ...runtime.userEnv,
    };
    const executionContext: AssistantExecutionContext = {
      hosted: {
        issueDeviceConnectLink: createHostedDeviceConnectLinkIssuer({
          boundUserId: input.request.dispatch.event.userId,
          platform: runtime.platform,
        }),
        memberId: input.request.dispatch.event.userId,
        userEnvKeys: Object.keys(runtime.userEnv),
      },
    };

    return await withHostedProcessEnvironment(
      {
        envOverrides: runtimeEnv,
        operatorHomeRoot: restored.operatorHomeRoot,
        vaultRoot: restored.vaultRoot,
      },
      async () => {
        const typingIndicator = startHostedDispatchTypingIndicator({
          dispatch: input.request.dispatch,
          runtimeEnv,
          run: input.request.run ?? null,
        });

        try {
          const committedExecution = input.request.resume?.committedResult
            ? resumeHostedCommittedExecution(input.request)
            : await executeHostedDispatchForCommit({
                artifactMaterializer: incomingBundle
                  ? createHostedArtifactMaterializer({
                      artifactResolver,
                      bundle: incomingBundle,
                      materializedArtifactPaths,
                      workspaceRoot,
                    })
                  : null,
                materializedArtifactPaths,
                request: input.request,
                restored,
                runtime,
                executionContext,
                runtimeEnv,
              });

          if (!input.request.resume?.committedResult) {
            await commitHostedExecutionResult({
              commit: input.request.commit ?? null,
              dispatch: input.request.dispatch,
              effectsPort: runtime.platform.effectsPort,
              gatewayProjectionSnapshot: committedExecution.committedGatewayProjectionSnapshot,
              result: committedExecution.committedResult,
              sideEffects:
                committedExecution.committedSideEffects
                ?? committedExecution.committedAssistantDeliveryEffects,
            });
            emitHostedExecutionStructuredLog({
              component: "runtime",
              dispatch: input.request.dispatch,
              message: "Hosted runtime recorded a durable commit callback.",
              phase: "commit.recorded",
              run: input.request.run ?? null,
            });
          }

          const finalResult = await completeHostedExecutionAfterCommit({
            commit: input.request.commit ?? null,
            dispatch: input.request.dispatch,
            materializedArtifactPaths,
            run: input.request.run ?? null,
            runtime,
            restored,
            committedExecution,
          });

          emitHostedExecutionStructuredLog({
            component: "runtime",
            dispatch: input.request.dispatch,
            message: "Hosted runtime completed.",
            phase: "completed",
            run: input.request.run ?? null,
          });

          return finalResult;
        } finally {
          await stopHostedDispatchTypingIndicator({
            dispatch: input.request.dispatch,
            typingIndicator,
            run: input.request.run ?? null,
          });
        }
      },
    );
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "runtime",
      dispatch: input.request.dispatch,
      error,
      message: "Hosted runtime failed.",
      phase: "failed",
      run: input.request.run ?? null,
    });
    throw error;
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
}

function createHostedDeviceConnectLinkIssuer(input: {
  boundUserId: string;
  platform: HostedRuntimePlatform;
}) {
  return async ({ provider }: { provider: string }) => {
    const client = input.platform.deviceSyncPort ?? null;

    if (!client) {
      throw new HostedAssistantConfigurationError(
        "HOSTED_ASSISTANT_CONFIG_INVALID",
        "Hosted device connect links are unavailable because the device-sync control plane is not configured.",
      );
    }

    return client.createConnectLink({
      provider,
    });
  };
}
