import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type {
  HostedAssistantRuntimeResolvedConfig,
  HostedAssistantRuntimeConfig,
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";
import type {
  HostedRuntimePlatform,
} from "./platform.ts";

const HOSTED_RUNTIME_CHILD_AMBIENT_ENV_KEYS = [
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "NODE_EXTRA_CA_CERTS",
  "PATH",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TZ",
] as const;
export interface HostedRuntimeChildLauncherDirectories {
  cacheRoot: string;
  homeRoot: string;
  huggingFaceRoot: string;
  tempRoot: string;
}

export function normalizeHostedAssistantRuntimeConfig(
  input: HostedAssistantRuntimeConfig | undefined,
  platform: HostedRuntimePlatform | null | undefined,
): NormalizedHostedAssistantRuntimeConfig {
  const forwardedEnv = { ...(input?.forwardedEnv ?? {}) };
  const normalizedPlatform = platform ?? null;

  if (!normalizedPlatform) {
    throw new TypeError("Hosted assistant runtime platform must be injected.");
  }

  return {
    commitTimeoutMs: input?.commitTimeoutMs ?? null,
    forwardedEnv,
    platform: normalizedPlatform,
    resolvedConfig: cloneHostedAssistantRuntimeResolvedConfig(input?.resolvedConfig),
    userEnv: { ...(input?.userEnv ?? {}) },
  };
}

function cloneHostedAssistantRuntimeResolvedConfig(
  input: HostedAssistantRuntimeResolvedConfig | undefined,
): HostedAssistantRuntimeResolvedConfig {
  return {
    channelCapabilities: {
      emailSendReady: input?.channelCapabilities.emailSendReady ?? false,
      telegramBotConfigured: input?.channelCapabilities.telegramBotConfigured ?? false,
    },
    deviceSync: input?.deviceSync
      ? {
          providerConfigs: cloneConfiguredDeviceSyncProviderConfigs(input.deviceSync.providerConfigs),
          publicBaseUrl: input.deviceSync.publicBaseUrl,
          secret: input.deviceSync.secret,
        }
      : null,
  };
}

function cloneConfiguredDeviceSyncProviderConfigs(
  input: NonNullable<HostedAssistantRuntimeResolvedConfig["deviceSync"]>["providerConfigs"],
): NonNullable<HostedAssistantRuntimeResolvedConfig["deviceSync"]>["providerConfigs"] {
  return {
    ...(input.garmin
      ? {
          garmin: {
            ...input.garmin,
          },
        }
      : {}),
    ...(input.oura
      ? {
          oura: {
            ...input.oura,
            ...(input.oura.scopes ? { scopes: [...input.oura.scopes] } : {}),
          },
        }
      : {}),
    ...(input.whoop
      ? {
          whoop: {
            ...input.whoop,
            ...(input.whoop.scopes ? { scopes: [...input.whoop.scopes] } : {}),
          },
        }
      : {}),
  };
}

export function resolveHostedRuntimeTsconfigPath(): string {
  return fileURLToPath(new URL("../../../../tsconfig.base.json", import.meta.url));
}

export function resolveHostedRuntimeTsxImportSpecifier(
  moduleRequire: NodeJS.Require = resolveHostedRuntimeModuleRequire(),
): string {
  try {
    return pathToFileURL(moduleRequire.resolve("tsx")).href;
  } catch {
    return "tsx";
  }
}

function resolveHostedRuntimeModuleRequire(): NodeJS.Require {
  return createRequire(import.meta.url);
}

export async function createHostedRuntimeChildLauncherDirectories(
  launcherRoot: string,
): Promise<HostedRuntimeChildLauncherDirectories> {
  const directories = {
    cacheRoot: path.join(launcherRoot, "cache"),
    homeRoot: path.join(launcherRoot, "home"),
    huggingFaceRoot: path.join(launcherRoot, "hf-home"),
    tempRoot: path.join(launcherRoot, "tmp"),
  } satisfies HostedRuntimeChildLauncherDirectories;

  await Promise.all(
    Object.values(directories).map((directory) => mkdir(directory, { recursive: true })),
  );

  return directories;
}

export function createHostedRuntimeChildProcessEnv(input: {
  ambientEnv?: Readonly<Record<string, string | undefined>>;
  forwardedEnv: Record<string, string>;
  isTypeScriptChild: boolean;
  launcherDirectories: HostedRuntimeChildLauncherDirectories;
}): Record<string, string> {
  const env: Record<string, string> = {};
  const ambientEnv = input.ambientEnv ?? process.env;

  for (const key of HOSTED_RUNTIME_CHILD_AMBIENT_ENV_KEYS) {
    const value = ambientEnv[key];

    if (typeof value === "string" && value.length > 0) {
      env[key] = value;
    }
  }

  Object.assign(env, input.forwardedEnv, {
    HF_HOME: input.launcherDirectories.huggingFaceRoot,
    HOME: input.launcherDirectories.homeRoot,
    TEMP: input.launcherDirectories.tempRoot,
    TMP: input.launcherDirectories.tempRoot,
    TMPDIR: input.launcherDirectories.tempRoot,
    XDG_CACHE_HOME: input.launcherDirectories.cacheRoot,
  });

  if (input.isTypeScriptChild) {
    env.TSX_TSCONFIG_PATH = resolveHostedRuntimeTsconfigPath();
  }

  return env;
}

export async function withHostedProcessEnvironment<T>(input: {
  envOverrides: Record<string, string>;
  operatorHomeRoot: string;
  vaultRoot: string;
}, run: () => Promise<T>): Promise<T> {
  const previousValues = new Map<string, string | undefined>();
  const nextValues: Record<string, string> = {
    ...input.envOverrides,
    HOME: input.operatorHomeRoot,
    VAULT: input.vaultRoot,
  };

  for (const [key, value] of Object.entries(nextValues)) {
    previousValues.set(key, process.env[key]);
    process.env[key] = value;
  }

  try {
    return await run();
  } finally {
    for (const [key, previousValue] of previousValues) {
      if (previousValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousValue;
      }
    }
  }
}
