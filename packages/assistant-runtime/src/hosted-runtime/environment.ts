import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DEFAULT_HOSTED_EXECUTION_ARTIFACTS_BASE_URL,
  DEFAULT_HOSTED_EXECUTION_COMMIT_BASE_URL,
  DEFAULT_HOSTED_EXECUTION_DEVICE_SYNC_PROXY_BASE_URL,
  DEFAULT_HOSTED_EXECUTION_EMAIL_BASE_URL,
  DEFAULT_HOSTED_EXECUTION_SHARE_PACK_PROXY_BASE_URL,
  DEFAULT_HOSTED_EXECUTION_SIDE_EFFECTS_BASE_URL,
  DEFAULT_HOSTED_EXECUTION_USAGE_PROXY_BASE_URL,
  HOSTED_EXECUTION_PROXY_HOSTS,
  normalizeHostedExecutionString,
  readHostedExecutionWebControlPlaneEnvironment,
  type HostedExecutionWebControlPlaneEnvironment,
} from "@murphai/hosted-execution";

export { hostedAssistantAutomationEnabledFromEnv } from "@murphai/hosted-execution";
import type {
  HostedAssistantRuntimeConfig,
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";

const hostedRuntimeModuleRequire = createRequire(import.meta.url);
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
): NormalizedHostedAssistantRuntimeConfig {
  const forwardedEnv = { ...(input?.forwardedEnv ?? {}) };
  const webControlPlane = readHostedExecutionWebControlPlaneEnvironment(forwardedEnv, {
    allowHttpHosts: Object.values(HOSTED_EXECUTION_PROXY_HOSTS),
    allowHttpLocalhost: true,
  });

  return {
    artifactsBaseUrl: DEFAULT_HOSTED_EXECUTION_ARTIFACTS_BASE_URL,
    commitBaseUrl: DEFAULT_HOSTED_EXECUTION_COMMIT_BASE_URL,
    commitTimeoutMs: input?.commitTimeoutMs ?? null,
    emailBaseUrl: DEFAULT_HOSTED_EXECUTION_EMAIL_BASE_URL,
    internalWorkerProxyToken: normalizeHostedExecutionString(input?.internalWorkerProxyToken),
    forwardedEnv,
    sideEffectsBaseUrl: DEFAULT_HOSTED_EXECUTION_SIDE_EFFECTS_BASE_URL,
    userEnv: { ...(input?.userEnv ?? {}) },
    webControlPlane: {
      ...webControlPlane,
      deviceSyncRuntimeBaseUrl:
        webControlPlane.deviceSyncRuntimeBaseUrl
        ?? DEFAULT_HOSTED_EXECUTION_DEVICE_SYNC_PROXY_BASE_URL,
      shareBaseUrl:
        webControlPlane.shareBaseUrl
        ?? DEFAULT_HOSTED_EXECUTION_SHARE_PACK_PROXY_BASE_URL,
      usageBaseUrl:
        webControlPlane.usageBaseUrl
        ?? DEFAULT_HOSTED_EXECUTION_USAGE_PROXY_BASE_URL,
    },
  };
}

export function resolveHostedRuntimeChildEntry(): string {
  const builtPath = fileURLToPath(new URL("../hosted-runtime-child.js", import.meta.url));

  if (existsSync(builtPath)) {
    return builtPath;
  }

  return fileURLToPath(new URL("../hosted-runtime-child.ts", import.meta.url));
}

export function resolveHostedRuntimeTsconfigPath(): string {
  return fileURLToPath(new URL("../../../../tsconfig.base.json", import.meta.url));
}

export function resolveHostedRuntimeTsxImportSpecifier(): string {
  try {
    return pathToFileURL(hostedRuntimeModuleRequire.resolve("tsx")).href;
  } catch {
    return "tsx";
  }
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
