import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DEFAULT_HOSTED_EXECUTION_ARTIFACTS_BASE_URL,
  DEFAULT_HOSTED_EXECUTION_RESULTS_BASE_URL,
  HOSTED_EXECUTION_CALLBACK_HOSTS,
  normalizeHostedExecutionBaseUrl,
  normalizeHostedExecutionString,
  readHostedExecutionWebControlPlaneEnvironment,
} from "@murphai/hosted-execution";
import type {
  HostedAssistantRuntimeConfig,
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";

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
const HOSTED_RUNTIME_TEST_ARTIFACTS_BASE_URL_ENV =
  "HOSTED_EXECUTION_TEST_ARTIFACTS_BASE_URL";
const HOSTED_RUNTIME_TEST_RESULTS_BASE_URL_ENV =
  "HOSTED_EXECUTION_TEST_RESULTS_BASE_URL";
const HOSTED_RUNTIME_TEST_COMMIT_BASE_URL_ENV =
  "HOSTED_EXECUTION_TEST_COMMIT_BASE_URL";
const HOSTED_RUNTIME_TEST_EMAIL_BASE_URL_ENV =
  "HOSTED_EXECUTION_TEST_EMAIL_BASE_URL";
const HOSTED_RUNTIME_TEST_SIDE_EFFECTS_BASE_URL_ENV =
  "HOSTED_EXECUTION_TEST_SIDE_EFFECTS_BASE_URL";

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
  const callbackBaseUrls = resolveHostedRuntimeCallbackBaseUrls(forwardedEnv);
  const webControlPlane = readHostedExecutionWebControlPlaneEnvironment(forwardedEnv);

  return {
    artifactsBaseUrl: callbackBaseUrls.artifactsBaseUrl,
    commitTimeoutMs: input?.commitTimeoutMs ?? null,
    forwardedEnv,
    internalWorkerProxyToken: normalizeHostedExecutionString(input?.internalWorkerProxyToken),
    resultsBaseUrl: callbackBaseUrls.resultsBaseUrl,
    userEnv: { ...(input?.userEnv ?? {}) },
    webControlPlane,
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
    return pathToFileURL(resolveHostedRuntimeModuleRequire().resolve("tsx")).href;
  } catch {
    return "tsx";
  }
}

function resolveHostedRuntimeModuleRequire(): NodeJS.Require {
  return createRequire(import.meta.url);
}

function resolveHostedRuntimeCallbackBaseUrls(
  forwardedEnv: Readonly<Record<string, string>>,
): Pick<
  NormalizedHostedAssistantRuntimeConfig,
  "artifactsBaseUrl" | "resultsBaseUrl"
> {
  return {
    artifactsBaseUrl: normalizeHostedRuntimeCallbackBaseUrl(
      forwardedEnv[HOSTED_RUNTIME_TEST_ARTIFACTS_BASE_URL_ENV],
      DEFAULT_HOSTED_EXECUTION_ARTIFACTS_BASE_URL,
      HOSTED_EXECUTION_CALLBACK_HOSTS.artifacts,
    ),
    resultsBaseUrl: normalizeHostedRuntimeCallbackBaseUrl(
      readHostedRuntimeResultsBaseUrlOverride(forwardedEnv),
      DEFAULT_HOSTED_EXECUTION_RESULTS_BASE_URL,
      HOSTED_EXECUTION_CALLBACK_HOSTS.results,
    ),
  };
}

function readHostedRuntimeResultsBaseUrlOverride(
  forwardedEnv: Readonly<Record<string, string>>,
): string | undefined {
  const configuredValues = [
    forwardedEnv[HOSTED_RUNTIME_TEST_RESULTS_BASE_URL_ENV],
    forwardedEnv[HOSTED_RUNTIME_TEST_COMMIT_BASE_URL_ENV],
    forwardedEnv[HOSTED_RUNTIME_TEST_EMAIL_BASE_URL_ENV],
    forwardedEnv[HOSTED_RUNTIME_TEST_SIDE_EFFECTS_BASE_URL_ENV],
  ]
    .map((value) => normalizeHostedExecutionString(value))
    .filter((value): value is string => value !== null);

  if (configuredValues.length === 0) {
    return undefined;
  }

  const [firstValue, ...restValues] = configuredValues;
  if (restValues.some((value) => value !== firstValue)) {
    throw new TypeError(
      "Hosted assistant runtime results callback base URL overrides must agree.",
    );
  }

  return firstValue;
}

function normalizeHostedRuntimeCallbackBaseUrl(
  value: string | undefined,
  fallback: string,
  host: string,
): string {
  const normalized = normalizeHostedExecutionBaseUrl(value ?? fallback, {
    allowHttpHosts: [host],
    allowHttpLocalhost: true,
  });

  if (!normalized) {
    throw new TypeError("Hosted assistant runtime callback baseUrl must be configured.");
  }

  return normalized;
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
