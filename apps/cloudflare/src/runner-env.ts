import type {
  HostedAssistantRuntimeConfig,
  HostedAssistantRuntimeParserToolchainConfig,
  HostedAssistantRuntimeResolvedConfig,
} from "@murphai/assistant-runtime/hosted-runtime-worker-contracts";
import {
  HOSTED_SHARED_DEVICE_SYNC_PLATFORM_ENV_NAMES,
} from "@murphai/assistant-runtime/hosted-assistant-env-constants";
import {
  buildHostedRuntimeChildEnv,
  buildHostedRuntimeLaunchSpec,
  buildHostedRuntimePlatformEnv,
  readHostedRuntimeCommitTimeoutConfigValue,
} from "@murphai/assistant-runtime/hosted-runtime-worker-contracts";

import {
  buildHostedRunnerAmbientEnv,
  buildHostedRunnerContainerEnv,
  filterHostedRunnerSecrets,
  rewriteHostedRunnerLoopbackUrlForContainer,
} from "./hosted-env-policy.ts";
import {
  createHostedRunnerLocalE2eParserToolchain,
} from "./runner-native-parser-toolchain.ts";

const HOSTED_LEGACY_DEVICE_SYNC_PLATFORM_ENV_KEYS =
  new Set<string>(HOSTED_SHARED_DEVICE_SYNC_PLATFORM_ENV_NAMES);

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
  const parserToolchain = readHostedRunnerParserToolchain(input.parserToolchain);

  return buildHostedRuntimeLaunchSpec({
    commitTimeoutMs: input.commitTimeoutMs ?? null,
    configSource: input.configSource,
    forwardedEnv: input.forwardedEnv,
    ...(parserToolchain === undefined ? {} : { parserToolchain }),
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

export function buildHostedRunnerLegacyDeviceSyncPlatformEnv(
  source: Readonly<Record<string, unknown>>,
  options: {
    rewriteLoopbackUrlsForContainer?: boolean;
  } = {},
): Record<string, string> {
  const platformEnv = buildHostedRunnerPlatformEnv(source, options);

  return Object.fromEntries(
    Object.entries(platformEnv).filter(([key]) =>
      HOSTED_LEGACY_DEVICE_SYNC_PLATFORM_ENV_KEYS.has(key)
    ),
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
  const platformEnv = buildHostedRunnerLegacyDeviceSyncPlatformEnv(configSource, {
    rewriteLoopbackUrlsForContainer: input.rewritePlatformUrlsForContainer === true,
  });
  const localE2eParserToolchain =
    createHostedRunnerLocalE2eParserToolchain(configSource);

  return buildHostedRunnerJobRuntime({
    commitTimeoutMs: readHostedRuntimeCommitTimeoutConfigValue(
      configSource.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS,
    ),
    configSource,
    forwardedEnv: input.forwardedEnv,
    parserToolchain: localE2eParserToolchain ?? undefined,
    platformEnv,
    resolvedConfig: input.resolvedConfig,
    runnerSecrets: input.runnerSecrets,
  });
}

export function buildHostedRunnerIdleCheckpointRuntimeConfig(input: {
  configSource?: Readonly<Record<string, string | undefined>>;
  forwardedEnv: Readonly<Record<string, string>>;
  rewritePlatformUrlsForContainer?: boolean;
}): HostedAssistantRuntimeConfig {
  const configSource = input.configSource ?? input.forwardedEnv;
  const platformEnv = buildHostedRunnerLegacyDeviceSyncPlatformEnv(configSource, {
    rewriteLoopbackUrlsForContainer: input.rewritePlatformUrlsForContainer === true,
  });

  return buildHostedRunnerJobRuntime({
    commitTimeoutMs: readHostedRuntimeCommitTimeoutConfigValue(
      configSource.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS,
    ),
    configSource,
    forwardedEnv: input.forwardedEnv,
    platformEnv,
    runnerSecrets: {},
  });
}

function readHostedRunnerParserToolchain(
  parserToolchain:
    | HostedAssistantRuntimeParserToolchainConfig
    | null
    | undefined,
): HostedAssistantRuntimeParserToolchainConfig | undefined {
  if (parserToolchain === null) {
    throw new TypeError(
      "Hosted runner parserToolchain:null is not supported; omit parserToolchain to use the runner image toolchain.",
    );
  }

  return parserToolchain;
}
