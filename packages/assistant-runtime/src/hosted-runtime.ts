import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  decodeHostedBundleBase64,
  materializeHostedExecutionArtifacts,
  restoreHostedExecutionContext,
} from "@murphai/runtime-state/node";
import type {
  HostedExecutionRunnerResult,
} from "@murphai/hosted-execution";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  parseCanonicalLinqMessageReceivedEvent,
  parseLinqWebhookEvent,
} from "@murphai/messaging-ingress/linq-webhook";
import {
  HostedAssistantConfigurationError,
} from "@murphai/operator-config/hosted-assistant-config";
import {
  startLinqChatTypingIndicator,
  stopLinqChatTypingIndicator,
} from "@murphai/operator-config/linq-runtime";
import type { AssistantExecutionContext } from "@murphai/assistant-engine";

import {
  commitHostedExecutionResult,
  resumeHostedCommittedExecution,
} from "./hosted-runtime/callbacks.ts";
import { createHostedArtifactResolver } from "./hosted-runtime/artifacts.ts";
import {
  normalizeHostedAssistantRuntimeConfig,
  withHostedProcessEnvironment,
} from "./hosted-runtime/environment.ts";
import {
  completeHostedExecutionAfterCommit,
  executeHostedDispatchForCommit,
} from "./hosted-runtime/execution.ts";
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
                  ? async (relativePaths) => {
                      const pendingPaths = [...new Set(relativePaths)]
                        .filter((relativePath) => !materializedArtifactPaths.has(relativePath));
                      if (pendingPaths.length === 0) {
                        return;
                      }

                      await materializeHostedExecutionArtifacts({
                        artifactResolver,
                        bundle: incomingBundle,
                        shouldRestoreArtifact: ({ path: artifactPath, root }) => (
                          root === "vault" && pendingPaths.includes(artifactPath)
                        ),
                        workspaceRoot,
                      });
                      for (const relativePath of pendingPaths) {
                        materializedArtifactPaths.add(relativePath);
                      }
                    }
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

type HostedDispatchTypingIndicator = {
  stop(): Promise<void>;
};

function startHostedDispatchTypingIndicator(input: {
  dispatch: HostedAssistantRuntimeJobInput["request"]["dispatch"];
  runtimeEnv: Readonly<Record<string, string>>;
  run: HostedAssistantRuntimeJobInput["request"]["run"] | null;
}): HostedDispatchTypingIndicator | null {
  if (input.dispatch.event.kind !== "linq.message.received") {
    return null;
  }

  const env = input.runtimeEnv as NodeJS.ProcessEnv;

  let chatId: string;
  try {
    const event = parseCanonicalLinqMessageReceivedEvent(
      parseLinqWebhookEvent(JSON.stringify(input.dispatch.event.linqEvent)),
    );
    chatId = event.data.chat_id;
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "runtime",
      dispatch: input.dispatch,
      error,
      level: "warn",
      message: "Hosted Linq typing indicator could not be started.",
      phase: "dispatch.running",
      run: input.run,
    });
    return null;
  }

  let active = false;
  let stopRequested = false;
  let stopPromise: Promise<void> | null = null;

  const runStop = () => {
    if (!stopPromise) {
      stopPromise = stopLinqChatTypingIndicator(
        {
          chatId,
        },
        {
          env,
        },
      )
        .catch((error) => {
          emitHostedExecutionStructuredLog({
            component: "runtime",
            dispatch: input.dispatch,
            error,
            level: "warn",
            message: "Hosted Linq typing indicator could not be stopped.",
            phase: "side-effects.draining",
            run: input.run,
          });
        })
        .finally(() => {
          active = false;
        });
    }

    return stopPromise;
  };

  const startPromise = startLinqChatTypingIndicator(
    {
      chatId,
    },
    {
      env,
    },
  )
    .then(async () => {
      active = true;
      if (stopRequested) {
        await runStop();
      }
    })
    .catch((error) => {
      emitHostedExecutionStructuredLog({
        component: "runtime",
        dispatch: input.dispatch,
        error,
        level: "warn",
        message: "Hosted Linq typing indicator could not be started.",
        phase: "dispatch.running",
        run: input.run,
      });
    });

  return {
    async stop() {
      if (stopRequested) {
        await (stopPromise ?? startPromise);
        return;
      }

      stopRequested = true;
      if (active) {
        await runStop();
        return;
      }

      await startPromise;
      if (active) {
        await runStop();
      }
    },
  };
}

async function stopHostedDispatchTypingIndicator(input: {
  dispatch: HostedAssistantRuntimeJobInput["request"]["dispatch"];
  typingIndicator: HostedDispatchTypingIndicator | null;
  run: HostedAssistantRuntimeJobInput["request"]["run"] | null;
}): Promise<void> {
  if (!input.typingIndicator) {
    return;
  }

  try {
    await input.typingIndicator.stop();
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "runtime",
      dispatch: input.dispatch,
      error,
      level: "warn",
      message: "Hosted Linq typing indicator could not be stopped.",
      phase: "side-effects.draining",
      run: input.run,
    });
  }
}
