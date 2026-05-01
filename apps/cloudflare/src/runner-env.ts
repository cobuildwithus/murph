import type {
  HostedAssistantRuntimeConfig,
  HostedAssistantRuntimeParserToolchainConfig,
  HostedAssistantRuntimeResolvedConfig,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  buildHostedRuntimeChildEnv,
  buildHostedRuntimeLaunchSpec,
  buildHostedRuntimePlatformEnv,
  readHostedRuntimeCommitTimeoutConfigValue,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";

import {
  buildHostedRunnerAmbientEnv,
  buildHostedRunnerContainerEnv,
  filterHostedRunnerSecrets,
  rewriteHostedRunnerLoopbackUrlForContainer,
} from "./hosted-env-policy.ts";
import {
  createHostedRunnerNativeParserToolchain,
} from "./runner-native-parser-toolchain.ts";

export function buildHostedRunnerSupervisorEnv(input: {
  port: number;
  runnerControlToken?: string | null;
}): Record<string, string> {
  return {
    ...(input.runnerControlToken
      ? { HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: input.runnerControlToken }
      : {}),
    PORT: String(input.port),
  };
}

export function buildHostedRunnerJobRuntime(input: {
  commitTimeoutMs?: number | null;
  configSource?: Readonly<Record<string, string | undefined>>;
  forwardedEnv: Readonly<Record<string, string>>;
  parserToolchain?: HostedAssistantRuntimeParserToolchainConfig | null;
  platformEnv?: Readonly<Record<string, string>>;
  resolvedConfig?: HostedAssistantRuntimeResolvedConfig;
  runnerSecrets?: Readonly<Record<string, string>>;
}): HostedAssistantRuntimeConfig {
  const runnerSecretPolicySource = {
    ...(input.configSource ?? input.forwardedEnv),
    ...buildHostedRuntimePlatformEnv(input.platformEnv ?? input.forwardedEnv),
  };

  return buildHostedRuntimeLaunchSpec({
    commitTimeoutMs: input.commitTimeoutMs ?? null,
    configSource: input.configSource,
    forwardedEnv: input.forwardedEnv,
    parserToolchain:
      input.parserToolchain
      ?? createHostedRunnerNativeParserToolchain(input.configSource ?? input.forwardedEnv),
    platformEnv: input.platformEnv,
    resolvedConfig: input.resolvedConfig,
    userEnv: filterHostedRunnerSecrets(
      input.runnerSecrets ?? {},
      runnerSecretPolicySource,
    ),
  }).runtime;
}

export {
  buildHostedRunnerAmbientEnv,
  buildHostedRunnerContainerEnv,
  filterHostedRunnerSecrets,
};

export function buildHostedRunnerChildRuntimeEnv(input: {
  ambientSource?: Readonly<Record<string, unknown>>;
  forwardedEnv?: Readonly<Record<string, string>>;
} = {}): Record<string, string> {
  if (input.forwardedEnv) {
    return buildHostedRuntimeChildEnv({
      forwardedEnv: input.forwardedEnv,
    });
  }

  return buildHostedRuntimeChildEnv({
    forwardedEnv: buildHostedRunnerAmbientEnv(input.ambientSource ?? process.env),
  });
}

export function buildHostedRunnerPlatformEnv(
  source: Readonly<Record<string, unknown>>,
  options: {
    rewriteLoopbackUrlsForContainer?: boolean;
  } = {},
): Record<string, string> {
  const platformEnv = buildHostedRuntimePlatformEnv(source);

  if (!options.rewriteLoopbackUrlsForContainer) {
    return platformEnv;
  }

  return Object.fromEntries(
    Object.entries(platformEnv).map(([key, value]) => [
      key,
      rewriteHostedRunnerLoopbackUrlForContainer(key, value, source),
    ]),
  );
}

export function buildHostedRunnerJobRuntimeConfig(input: {
  configSource?: Readonly<Record<string, string | undefined>>;
  forwardedEnv: Readonly<Record<string, string>>;
  rewritePlatformUrlsForContainer?: boolean;
  resolvedConfig?: HostedAssistantRuntimeResolvedConfig;
  runnerSecrets: Readonly<Record<string, string>>;
}): HostedAssistantRuntimeConfig {
  const configSource = input.configSource ?? input.forwardedEnv;
  const platformEnv = buildHostedRunnerPlatformEnv(configSource, {
    rewriteLoopbackUrlsForContainer: input.rewritePlatformUrlsForContainer === true,
  });

  return buildHostedRunnerJobRuntime({
    commitTimeoutMs: readHostedRuntimeCommitTimeoutConfigValue(
      configSource.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS,
    ),
    configSource,
    forwardedEnv: input.forwardedEnv,
    platformEnv: Object.keys(platformEnv).length === 0 ? undefined : platformEnv,
    resolvedConfig: input.resolvedConfig,
    runnerSecrets: input.runnerSecrets,
  });
}
