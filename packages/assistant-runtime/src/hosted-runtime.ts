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
  HostedAssistantConfigurationError,
} from "@murphai/operator-config/hosted-assistant-config";
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

interface HostedAssistantRuntimeChildResult {
  ok: boolean;
  error?: {
    code?: string | null;
    message: string;
    name?: string | null;
    stack?: string | null;
  };
  result?: HostedAssistantRuntimeJobResult;
}

const HOSTED_RUNTIME_CHILD_RESULT_PREFIX = "__HB_ASSISTANT_RUNTIME_RESULT__";

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
            sideEffects: committedExecution.committedSideEffects,
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

function createHostedRuntimeChildError(
  error: HostedAssistantRuntimeChildResult["error"] | undefined,
  code: number | null,
): Error {
  const message = error?.message
    ?? `Hosted assistant runtime child exited with code ${code ?? "unknown"}.`;

  if (error?.name === "HostedAssistantConfigurationError") {
    const classified = new HostedAssistantConfigurationError(
      error.code === "HOSTED_ASSISTANT_CONFIG_REQUIRED"
        ? "HOSTED_ASSISTANT_CONFIG_REQUIRED"
        : "HOSTED_ASSISTANT_CONFIG_INVALID",
      message,
    );
    classified.stack = error.stack ?? classified.stack;
    return classified;
  }

  const untyped = new Error(message);
  if (error?.name) {
    untyped.name = error.name;
  }
  if (error?.stack) {
    untyped.stack = error.stack;
  }
  return untyped;
}

export function formatHostedRuntimeChildResult(
  payload: HostedAssistantRuntimeChildResult,
): string {
  return `${HOSTED_RUNTIME_CHILD_RESULT_PREFIX}${Buffer.from(
    JSON.stringify(payload),
    "utf8",
  ).toString("base64")}`;
}

export function parseHostedRuntimeChildResult(output: string): HostedAssistantRuntimeChildResult {
  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const encoded = [...lines]
    .reverse()
    .find((line) => line.startsWith(HOSTED_RUNTIME_CHILD_RESULT_PREFIX));

  if (!encoded) {
    throw new Error("Hosted assistant runtime child did not emit a result payload.");
  }

  return JSON.parse(
    Buffer.from(
      encoded.slice(HOSTED_RUNTIME_CHILD_RESULT_PREFIX.length),
      "base64",
    ).toString("utf8"),
  ) as HostedAssistantRuntimeChildResult;
}
