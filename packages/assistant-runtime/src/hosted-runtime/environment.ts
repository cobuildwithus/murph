import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DEFAULT_HOSTED_EXECUTION_ARTIFACTS_BASE_URL,
  DEFAULT_HOSTED_EXECUTION_COMMIT_BASE_URL,
  DEFAULT_HOSTED_EXECUTION_SIDE_EFFECTS_BASE_URL,
  HOSTED_EXECUTION_CALLBACK_HOSTS,
  HOSTED_EXECUTION_PROXY_HOSTS,
  normalizeHostedExecutionBaseUrl,
  normalizeHostedExecutionString,
  type HostedExecutionWebControlPlaneEnvironment,
} from "@murphai/hosted-execution";

import { normalizeHostedEmailBaseUrl } from "../hosted-email.ts";
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
  return {
    artifactsBaseUrl: normalizeCallbackBaseUrl(
      input?.artifactsBaseUrl,
      DEFAULT_HOSTED_EXECUTION_ARTIFACTS_BASE_URL,
    ),
    commitBaseUrl: normalizeCallbackBaseUrl(
      input?.commitBaseUrl,
      DEFAULT_HOSTED_EXECUTION_COMMIT_BASE_URL,
    ),
    commitTimeoutMs: input?.commitTimeoutMs ?? null,
    emailBaseUrl: normalizeHostedEmailBaseUrl(input?.emailBaseUrl),
    internalWorkerProxyToken: normalizeHostedExecutionString(input?.internalWorkerProxyToken),
    forwardedEnv: { ...(input?.forwardedEnv ?? {}) },
    sideEffectsBaseUrl: normalizeCallbackBaseUrl(
      input?.sideEffectsBaseUrl,
      DEFAULT_HOSTED_EXECUTION_SIDE_EFFECTS_BASE_URL,
    ),
    userEnv: { ...(input?.userEnv ?? {}) },
    webControlPlane: normalizeHostedExecutionWebControlPlaneConfig(input?.webControlPlane ?? null),
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

export function hostedAssistantAutomationEnabledFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const normalized = normalizeHostedExecutionString(env.HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION)?.toLowerCase();

  if (!normalized) {
    return true;
  }

  return normalized !== "0"
    && normalized !== "false"
    && normalized !== "no"
    && normalized !== "off"
    && normalized !== "disabled";
}

export async function withHostedProcessEnvironment<T>(input: {
  envOverrides: Record<string, string>;
  hostedMemberId: string;
  hostedUserEnvKeys: readonly string[];
  operatorHomeRoot: string;
  vaultRoot: string;
}, run: () => Promise<T>): Promise<T> {
  const previousValues = new Map<string, string | undefined>();
  const nextValues: Record<string, string> = {
    ...input.envOverrides,
    HOSTED_EXECUTION_USER_ENV_KEYS: input.hostedUserEnvKeys.join(","),
    HOSTED_MEMBER_ID: input.hostedMemberId,
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

function normalizeCallbackBaseUrl(value: string | null | undefined, fallback: string): string {
  const candidate = value && value.trim().length > 0 ? value : fallback;
  const normalized = normalizeHostedExecutionBaseUrl(candidate, {
    allowHttpHosts: Object.values(HOSTED_EXECUTION_CALLBACK_HOSTS),
    allowHttpLocalhost: true,
  });

  if (!normalized) {
    throw new TypeError("Hosted assistant runtime callback baseUrl must be configured.");
  }

  return normalized;
}

function normalizeHostedExecutionWebControlPlaneConfig(
  value: Partial<HostedExecutionWebControlPlaneEnvironment> | null,
): HostedExecutionWebControlPlaneEnvironment {
  return {
    deviceSyncRuntimeBaseUrl: normalizeHostedExecutionBaseUrl(value?.deviceSyncRuntimeBaseUrl, {
      allowHttpHosts: [HOSTED_EXECUTION_PROXY_HOSTS.deviceSync],
      allowHttpLocalhost: true,
    }),
    internalToken: normalizeHostedExecutionString(value?.internalToken),
    schedulerToken: normalizeHostedExecutionString(value?.schedulerToken),
    shareBaseUrl: normalizeHostedExecutionBaseUrl(value?.shareBaseUrl, {
      allowHttpHosts: [HOSTED_EXECUTION_PROXY_HOSTS.sharePack],
      allowHttpLocalhost: true,
    }),
    shareToken: normalizeHostedExecutionString(value?.shareToken),
    usageBaseUrl: normalizeHostedExecutionBaseUrl(value?.usageBaseUrl, {
      allowHttpHosts: [HOSTED_EXECUTION_PROXY_HOSTS.usage],
      allowHttpLocalhost: true,
    }),
  };
}
