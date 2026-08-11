import type {
  HostedAssistantRuntimeConfig,
  HostedAssistantRuntimeParserToolchainConfig,
  HostedAssistantRuntimeResolvedConfig,
} from "@murphai/assistant-runtime/hosted-runtime-worker-contracts";
import {
  HOSTED_SHARED_DEVICE_SYNC_PLATFORM_ENV_NAMES,
} from "@murphai/assistant-runtime/hosted-runtime-worker-contracts";
import {
  MURPH_ANDROID_APP_ENABLED_ENV,
} from "@murphai/hosted-execution/env";
import {
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
  createHostedRunnerNativeParserToolchain,
  createHostedRunnerLocalE2eParserToolchain,
} from "./runner-native-parser-toolchain.ts";
import {
  HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
} from "./runner-injected-credential.ts";

const HOSTED_LEGACY_DEVICE_SYNC_PLATFORM_ENV_KEYS =
  new Set<string>(HOSTED_SHARED_DEVICE_SYNC_PLATFORM_ENV_NAMES);
const HOSTED_PRIVATE_MEDIA_DELIVERY_ORIGIN_ENV = "CF_PUBLIC_BASE_URL";
const HOSTED_PHYSICAL_NOTES_ENABLED_ENV = "HOSTED_PHYSICAL_NOTES_ENABLED";

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

export function buildHostedRunnerChannelPlatformEnv(
  source: Readonly<Record<string, unknown>>,
  options: {
    rewriteLoopbackUrlsForContainer?: boolean;
  } = {},
): Record<string, string> {
  const platformEnv = buildHostedRunnerPlatformEnv(source, options);
  const channelEnv: Record<string, string> = {};

  if (platformEnv.TELEGRAM_BOT_TOKEN) {
    copyHostedPlatformEnv(platformEnv, channelEnv, "TELEGRAM_API_BASE_URL");
    channelEnv.TELEGRAM_BOT_TOKEN = HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL;
    copyHostedPlatformEnv(platformEnv, channelEnv, "TELEGRAM_FILE_BASE_URL");
  }

  return channelEnv;
}

export function buildHostedRunnerContainerPlatformEnv(
  source: Readonly<Record<string, unknown>>,
  options: {
    rewriteLoopbackUrlsForContainer?: boolean;
  } = {},
): Record<string, string> {
  const platformEnv = buildHostedRunnerPlatformEnv(source, options);
  const privateMediaDeliveryOrigin =
    platformEnv[HOSTED_PRIVATE_MEDIA_DELIVERY_ORIGIN_ENV];
  const physicalNotesEnabled = platformEnv[HOSTED_PHYSICAL_NOTES_ENABLED_ENV];
  const androidAppEnabled = platformEnv[MURPH_ANDROID_APP_ENABLED_ENV];
  return {
    ...(privateMediaDeliveryOrigin
      ? {
          [HOSTED_PRIVATE_MEDIA_DELIVERY_ORIGIN_ENV]:
            privateMediaDeliveryOrigin,
        }
      : {}),
    ...(physicalNotesEnabled
      ? { [HOSTED_PHYSICAL_NOTES_ENABLED_ENV]: physicalNotesEnabled }
      : {}),
    ...(androidAppEnabled
      ? { [MURPH_ANDROID_APP_ENABLED_ENV]: androidAppEnabled }
      : {}),
    ...buildHostedRunnerLegacyDeviceSyncPlatformEnv(source, options),
    ...buildHostedRunnerChannelPlatformEnv(source, options),
  };
}

export function buildHostedRunnerJobRuntimeConfig(input: {
  configSource?: Readonly<Record<string, string | undefined>>;
  forwardedEnv: Readonly<Record<string, string>>;
  providerEgressCredentials?: {
    workersAiTranscribe?: string | null;
  };
  rewritePlatformUrlsForContainer?: boolean;
  resolvedConfig?: HostedAssistantRuntimeResolvedConfig;
  runnerSecrets: Readonly<Record<string, string>>;
}): HostedAssistantRuntimeConfig {
  const configSource = input.configSource ?? input.forwardedEnv;
  const platformEnv = buildHostedRunnerContainerPlatformEnv(input.configSource ?? {}, {
    rewriteLoopbackUrlsForContainer: input.rewritePlatformUrlsForContainer === true,
  });
  const localE2eParserToolchain =
    createHostedRunnerLocalE2eParserToolchain(configSource, {
      providerEgressCredential:
        input.providerEgressCredentials?.workersAiTranscribe ?? null,
    });
  const parserToolchain = localE2eParserToolchain ??
    createHostedRunnerNativeParserToolchain(configSource, {
      providerEgressCredential:
        input.providerEgressCredentials?.workersAiTranscribe ?? null,
    });

  return buildHostedRunnerJobRuntime({
    commitTimeoutMs: readHostedRuntimeCommitTimeoutConfigValue(
      configSource.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS,
    ),
    configSource,
    forwardedEnv: input.forwardedEnv,
    parserToolchain,
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
  const platformEnv = buildHostedRunnerContainerPlatformEnv(configSource, {
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

function copyHostedPlatformEnv(
  source: Readonly<Record<string, string>>,
  target: Record<string, string>,
  key: string,
): void {
  const value = source[key];
  if (value) {
    target[key] = value;
  }
}
