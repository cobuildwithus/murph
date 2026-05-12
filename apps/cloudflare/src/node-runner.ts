import {
  type HostedAssistantRuntimeConfig,
  type HostedAssistantWorkspaceRuntimeJobResult,
} from "@murphai/assistant-runtime";

import {
  buildHostedRunnerAmbientEnv,
  buildHostedRunnerJobRuntime,
  buildHostedRunnerPlatformEnv,
} from "./runner-env.ts";
import {
  createHostedRunnerNativeParserToolchain,
  isHostedRunnerLocalE2eParserToolchain,
} from "./runner-native-parser-toolchain.ts";
import {
  runHostedWorkspaceInvocationIsolatedDetailed,
  type HostedExecutionIsolatedRunnerInput,
} from "./node-runner-isolated.ts";
import {
  type HostedExecutionWorkspaceInvocationJobInput,
} from "./runner-job-transport.ts";

export interface HostedWorkspaceInvocationOptions {
  onChildReadyForRuntimeWake?: (sendWake: () => void) => void;
  signal?: AbortSignal;
}

export interface HostedWorkspaceInvocationRunnerDependencies {
  buildRuntime?: typeof buildHostedExecutionJobRuntime;
  onBeforeRun?: () => void;
  runIsolated?: (
    input: HostedExecutionIsolatedRunnerInput,
    options?: {
      onChildReadyForRuntimeWake?: (sendWake: () => void) => void;
      signal?: AbortSignal;
    },
  ) => Promise<HostedAssistantWorkspaceRuntimeJobResult>;
}

export interface HostedWorkspaceInvocationRunner {
  (
    input: HostedExecutionWorkspaceInvocationJobInput,
    options?: HostedWorkspaceInvocationOptions,
  ): Promise<HostedAssistantWorkspaceRuntimeJobResult>;
}

export function buildHostedExecutionJobRuntime(
  requestedRuntime: HostedAssistantRuntimeConfig,
): HostedAssistantRuntimeConfig {
  const forwardedEnv = requestedRuntime.forwardedEnv === undefined
    ? buildHostedRunnerAmbientEnv(process.env)
    : { ...requestedRuntime.forwardedEnv };
  const platformEnv = requestedRuntime.platformEnv === undefined
    ? requestedRuntime.forwardedEnv === undefined
      ? buildHostedRunnerPlatformEnv(process.env)
      : {}
    : { ...requestedRuntime.platformEnv };
  const configSource = requestedRuntime.forwardedEnv === undefined
    ? process.env
    : requestedRuntime.forwardedEnv;
  const parserToolchain = bindHostedExecutionJobParserToolchain(
    requestedRuntime.parserToolchain,
  );
  // Native parser paths are container-image facts. Do not trust or preserve
  // Worker-provided typed toolchain paths across the Worker -> container seam.

  // The worker-owned runtime envelope is the source of truth when present.
  // The container only falls back to ambient env for local/manual callers that omit it entirely.
  return buildHostedRunnerJobRuntime({
    commitTimeoutMs: requestedRuntime.commitTimeoutMs ?? null,
    configSource,
    forwardedEnv,
    parserToolchain,
    platformEnv,
    resolvedConfig: requestedRuntime.resolvedConfig,
    runnerSecrets: requestedRuntime.userEnv ?? {},
  });
}

function bindHostedExecutionJobParserToolchain(
  parserToolchain: HostedAssistantRuntimeConfig["parserToolchain"] | null | undefined,
): NonNullable<HostedAssistantRuntimeConfig["parserToolchain"]> {
  if (parserToolchain === null) {
    throw new TypeError(
      "Hosted runner parserToolchain:null is not supported; omit parserToolchain to use the runner image toolchain.",
    );
  }

  if (parserToolchain && isHostedRunnerLocalE2eParserToolchain(parserToolchain)) {
    return parserToolchain;
  }

  return createHostedRunnerNativeParserToolchain();
}

export function createHostedWorkspaceInvocationRunner(
  dependencies: HostedWorkspaceInvocationRunnerDependencies = {},
) {
  const buildRuntime = dependencies.buildRuntime ?? buildHostedExecutionJobRuntime;
  const onBeforeRun = dependencies.onBeforeRun;
  const runIsolated =
    dependencies.runIsolated ?? runHostedWorkspaceInvocationIsolatedDetailed;

  async function runHostedWorkspaceInvocation(
    input: HostedExecutionWorkspaceInvocationJobInput,
    options?: HostedWorkspaceInvocationOptions,
  ): Promise<HostedAssistantWorkspaceRuntimeJobResult>;
  async function runHostedWorkspaceInvocation(
    input: HostedExecutionWorkspaceInvocationJobInput,
    options?: HostedWorkspaceInvocationOptions,
  ): Promise<HostedAssistantWorkspaceRuntimeJobResult> {
    onBeforeRun?.();
    const runtime = buildRuntime(input.runtime ?? {});

    return await runIsolated({
      job: {
        ...input,
        runtime,
      },
    }, options);
  }
  return runHostedWorkspaceInvocation;
}

export const runHostedWorkspaceInvocation = createHostedWorkspaceInvocationRunner();
