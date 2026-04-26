import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  cloudflareDir,
  cloudflareDevVarsPath,
  DEFAULT_DATABASE_URL,
  repoRoot,
  WRANGLER_VAR_ALLOWLIST,
} from "./constants.ts";
import {
  HOSTED_WORKER_OPTIONAL_SECRET_NAMES,
  HOSTED_WORKER_REQUIRED_SECRET_NAMES,
} from "../../apps/cloudflare/scripts/deploy-automation/worker-secret-names.ts";
import {
  createEcP256JwkPairJson,
  parsePrivateEcP256Jwk,
  type EcP256JwkPairJson,
  toPublicEcP256Jwk,
} from "./crypto.ts";
import type {
  HostedExecutionOidcIdentity,
  HostedLocalDevConfig,
} from "./types.ts";

export async function resolveCloudflareLocalEnv(input: {
  config: HostedLocalDevConfig;
  oidcIdentity: HostedExecutionOidcIdentity;
  overrides?: Record<string, string | undefined>;
}): Promise<Record<string, string>> {
  const originalContents = await tryReadTextFile(cloudflareDevVarsPath);
  const existing = originalContents === null ? {} : parseEnvText(originalContents);

  return mergeCloudflareLocalEnv({
    config: input.config,
    existing,
    oidcIdentity: input.oidcIdentity,
    overrides: input.overrides,
  });
}

export async function loadHostedLocalBaseEnvironment(
  input: {
    source?: NodeJS.ProcessEnv;
  } = {},
): Promise<NodeJS.ProcessEnv> {
  const source = input.source ?? process.env;
  const [repoEnv, webEnv, webLocalEnv] = await Promise.all([
    readOptionalSimpleEnvFile(path.join(repoRoot, ".env")),
    readOptionalSimpleEnvFile(path.join(repoRoot, "apps/web/.env")),
    readOptionalSimpleEnvFile(path.join(repoRoot, "apps/web/.env.local")),
  ]);

  return normalizeHostedLocalBaseEnvironment({
    ...repoEnv,
    ...webEnv,
    ...webLocalEnv,
    ...source,
  });
}

export function mergeCloudflareLocalEnv(input: {
  config: HostedLocalDevConfig;
  existing: Record<string, string>;
  oidcIdentity: HostedExecutionOidcIdentity;
  overrides?: Record<string, string | undefined>;
  createEnvelopeKey?: () => string;
  createJwkPair?: () => EcP256JwkPairJson;
}): Record<string, string> {
  const createEnvelopeKey = input.createEnvelopeKey ?? (() => randomBytes(32).toString("base64"));
  const createJwkPair = input.createJwkPair ?? createEcP256JwkPairJson;
  const normalizedOverrides = normalizeOptionalEnvOverrides(input.overrides);
  const resolvedExisting = {
    ...input.existing,
    ...normalizedOverrides,
  };

  assertLocalWorkerOidcEnvironment(resolvedExisting);

  const automationKeys = resolvedExisting.HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK?.trim()
    && resolvedExisting.HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK?.trim()
    ? {
      privateJwkJson: resolvedExisting.HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK,
      publicJwkJson: resolvedExisting.HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK,
    }
    : createJwkPair();
  const callbackSigningPrivateJwkJson = resolvedExisting.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK?.trim()
    ? resolvedExisting.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK
    : createJwkPair().privateJwkJson;
  const webOrigin = `http://${input.config.webHost}:${input.config.webPort}`;
  const workerOrigin =
    `${input.config.workerProtocol}://${input.config.workerHost}:${input.config.workerPort}`;

  return {
    ...resolvedExisting,
    ALLOW_LOCAL_INTERNAL_PROXY: "true",
    HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY:
      resolvedExisting.HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY?.trim()
      ?? createEnvelopeKey(),
    HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY_ID:
      resolvedExisting.HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY_ID?.trim()
      ?? "v1",
    HOSTED_EXECUTION_AUTOMATION_RECIPIENT_KEY_ID:
      resolvedExisting.HOSTED_EXECUTION_AUTOMATION_RECIPIENT_KEY_ID?.trim()
      ?? "automation:v1",
    HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK: automationKeys.privateJwkJson,
    HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK: automationKeys.publicJwkJson,
    HOSTED_EXECUTION_RECOVERY_RECIPIENT_KEY_ID:
      resolvedExisting.HOSTED_EXECUTION_RECOVERY_RECIPIENT_KEY_ID?.trim()
      ?? "recovery:v1",
    HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK:
      resolvedExisting.HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK?.trim()
      ?? automationKeys.publicJwkJson,
    HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG: input.oidcIdentity.teamSlug,
    HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME: input.oidcIdentity.projectName,
    HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: input.oidcIdentity.environment,
    HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL:
      normalizedOverrides.HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL?.trim()
      ?? workerOrigin,
    HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: callbackSigningPrivateJwkJson,
    HOSTED_WEB_CALLBACK_SIGNING_KEY_ID:
      resolvedExisting.HOSTED_WEB_CALLBACK_SIGNING_KEY_ID?.trim()
      ?? "v1",
    HOSTED_WEB_BASE_URL: webOrigin,
  };
}

function normalizeOptionalEnvOverrides(
  input: Record<string, string | undefined> | undefined,
): Record<string, string> {
  if (!input) {
    return {};
  }

  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== "string") {
      continue;
    }

    values[key] = value;
  }

  return values;
}

function normalizeHostedLocalBaseEnvironment(
  input: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const environment = {
    ...input,
  };
  const teeAutomationKeyId =
    environment.HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_KEY_ID?.trim() ?? "";
  const teeAutomationPublicJwk =
    environment.HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_PUBLIC_JWK?.trim() ?? "";

  if (Boolean(teeAutomationKeyId) !== Boolean(teeAutomationPublicJwk)) {
    delete environment.HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_KEY_ID;
    delete environment.HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_PUBLIC_JWK;
  }

  return environment;
}

export function buildHostedLocalDevOverrides(
  config: HostedLocalDevConfig,
  cloudflareDevVars: Record<string, string>,
): NodeJS.ProcessEnv {
  const webOrigin = `http://${config.webHost}:${config.webPort}`;
  const workerBaseUrl = `${config.workerProtocol}://${config.workerHost}:${config.workerPort}`;
  const callbackPrivateJwkJson = cloudflareDevVars.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK;
  const callbackKeyId = cloudflareDevVars.HOSTED_WEB_CALLBACK_SIGNING_KEY_ID?.trim();
  const hostedWakeEncryptionKey = cloudflareDevVars.HOSTED_WAKE_ENCRYPTION_KEY?.trim();
  const hostedWakeEncryptionKeyVersion =
    cloudflareDevVars.HOSTED_WAKE_ENCRYPTION_KEY_VERSION?.trim();
  const hostedWakeEncryptionKeyringJson =
    cloudflareDevVars.HOSTED_WAKE_ENCRYPTION_KEYRING_JSON?.trim();

  return {
    HOSTED_EXECUTION_DISPATCH_URL: workerBaseUrl,
    HOSTED_ONBOARDING_PUBLIC_BASE_URL: webOrigin,
    ...(hostedWakeEncryptionKey
      ? {
        HOSTED_WAKE_ENCRYPTION_KEY: hostedWakeEncryptionKey,
      }
      : {}),
    ...(hostedWakeEncryptionKeyVersion
      ? {
        HOSTED_WAKE_ENCRYPTION_KEY_VERSION: hostedWakeEncryptionKeyVersion,
      }
      : {}),
    ...(hostedWakeEncryptionKeyringJson
      ? {
        HOSTED_WAKE_ENCRYPTION_KEYRING_JSON: hostedWakeEncryptionKeyringJson,
      }
      : {}),
    HOSTED_WEB_BASE_URL: webOrigin,
    ...(callbackPrivateJwkJson
      ? {
        HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK: JSON.stringify(
          toPublicEcP256Jwk(parsePrivateEcP256Jwk(callbackPrivateJwkJson)),
        ),
      }
      : {}),
    ...(callbackKeyId ? { HOSTED_WEB_CALLBACK_SIGNING_KEY_ID: callbackKeyId } : {}),
    VERCEL_PROJECT_PRODUCTION_URL: `${config.webHost}:${config.webPort}`,
  };
}

export function normalizeLocalDatabaseUrl(
  value: string | undefined,
  fallbackUrl: string = DEFAULT_DATABASE_URL,
): string {
  const normalized = value?.trim();

  if (!normalized) {
    return fallbackUrl;
  }

  let parsed: URL;
  let fallback: URL;
  try {
    parsed = new URL(normalized);
    fallback = new URL(fallbackUrl);
  } catch {
    return normalized;
  }

  if (!isPostgresProtocol(parsed.protocol) || !isLoopbackHost(parsed.hostname)) {
    return normalized;
  }

  if (hasExplicitDatabaseName(parsed.pathname) || !hasExplicitDatabaseName(fallback.pathname)) {
    return normalized;
  }

  parsed.pathname = fallback.pathname;
  return parsed.toString();
}

export function shouldSyncLocalDatabaseSchema(value: string | undefined): boolean {
  return isLoopbackPostgresUrl(normalizeLocalDatabaseUrl(value));
}

export function buildWranglerVarArgs(
  cloudflareDevVars: Readonly<Record<string, string | undefined>>,
): string[] {
  const args: string[] = [];

  for (const key of new Set(WRANGLER_VAR_ALLOWLIST)) {
    const value = cloudflareDevVars[key];

    if (!value?.trim()) {
      continue;
    }

    args.push("--var", `${key}:${value}`);
  }

  return args;
}

export function buildWranglerEnvFileText(
  source: Readonly<Record<string, string | undefined>>,
): string {
  const entries = new Map<string, string>();

  for (const key of [
    ...HOSTED_WORKER_REQUIRED_SECRET_NAMES,
    ...HOSTED_WORKER_OPTIONAL_SECRET_NAMES,
    ...WRANGLER_VAR_ALLOWLIST,
  ]) {
    const value = resolveWranglerEnvValue(key, source);

    if (!value) {
      continue;
    }

    entries.set(key, value);
  }

  return [...entries.entries()]
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n");
}

export function buildWranglerLocalDevConfig(
  source: Readonly<Record<string, string | undefined>>,
  options: {
    configDir?: string;
    cloudflareAppDir?: string;
    workspaceRoot?: string;
  } = {},
): Record<string, unknown> {
  const cloudflareAppDir = options.cloudflareAppDir ?? cloudflareDir;
  const workspaceRoot = options.workspaceRoot ?? repoRoot;
  const configDir = options.configDir ?? path.join(cloudflareAppDir, ".wrangler");
  const vars: Record<string, string> = {
    HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS: resolveWranglerEnvValue("HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS", source) ?? "3",
    HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY_ID: resolveWranglerEnvValue("HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY_ID", source) ?? "v1",
    HOSTED_EXECUTION_RETRY_DELAY_MS: resolveWranglerEnvValue("HOSTED_EXECUTION_RETRY_DELAY_MS", source) ?? "30000",
    HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: resolveWranglerEnvValue("HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS", source) ?? "30000",
    // Local Cloudflare container cold starts are materially slower than the hosted runtime.
    HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS: resolveWranglerEnvValue("HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS", source) ?? "60000",
    HOSTED_EXECUTION_RUNNER_TIMEOUT_MS: resolveWranglerEnvValue("HOSTED_EXECUTION_RUNNER_TIMEOUT_MS", source) ?? "120000",
    HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: resolveWranglerEnvValue("HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT", source) ?? "development",
  };

  for (const key of new Set(WRANGLER_VAR_ALLOWLIST)) {
    const value = resolveWranglerEnvValue(key, source);
    if (value) {
      vars[key] = value;
    }
  }

  const requiredSecrets = [
    ...HOSTED_WORKER_REQUIRED_SECRET_NAMES,
    ...HOSTED_WORKER_OPTIONAL_SECRET_NAMES.filter((key) => Boolean(resolveWranglerEnvValue(key, source))),
  ];

  return {
    name: "murph-hosted",
    main: toWranglerConfigRelativePath(configDir, path.join(cloudflareAppDir, "src", "index.ts")),
    compatibility_date: "2026-03-27",
    compatibility_flags: ["nodejs_compat"],
    containers: [
      {
        class_name: "RunnerContainer",
        image: toWranglerConfigRelativePath(
          configDir,
          path.join(workspaceRoot, "Dockerfile.cloudflare-hosted-runner"),
        ),
        image_build_context: toWranglerConfigRelativePath(configDir, cloudflareAppDir),
        instance_type: "standard-1",
        max_instances: 50,
      },
    ],
    durable_objects: {
      bindings: [
        {
          name: "USER_RUNNER",
          class_name: "UserRunnerDurableObject",
        },
        {
          name: "RUNNER_CONTAINER",
          class_name: "RunnerContainer",
        },
      ],
    },
    migrations: [
      {
        tag: "v1",
        new_sqlite_classes: ["UserRunnerDurableObject"],
      },
      {
        tag: "v2",
        new_sqlite_classes: ["RunnerContainer"],
      },
    ],
    r2_buckets: [
      {
        binding: "BUNDLES",
        bucket_name: "murph-hosted-bundles",
        preview_bucket_name: "murph-hosted-bundles-preview",
      },
    ],
    observability: {
      enabled: true,
      head_sampling_rate: 1,
      logs: {
        enabled: true,
        invocation_logs: true,
        persist: true,
        head_sampling_rate: 1,
      },
      traces: {
        enabled: true,
        persist: true,
        head_sampling_rate: 1,
      },
    },
    secrets: {
      required: requiredSecrets,
    },
    vars,
  };
}

function toWranglerConfigRelativePath(configDir: string, targetPath: string): string {
  return toPosixPath(path.relative(configDir, targetPath)) || ".";
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

export async function readSimpleEnvFile(filePath: string): Promise<Record<string, string>> {
  const raw = await readFile(filePath, "utf8");
  return parseEnvText(raw);
}

export async function readOptionalSimpleEnvFile(filePath: string): Promise<Record<string, string>> {
  const raw = await tryReadTextFile(filePath);
  return raw === null ? {} : parseEnvText(raw);
}

export function parseEnvText(raw: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  let index = 0;

  while (index < raw.length) {
    index = skipWhitespaceAndComments(raw, index);

    if (index >= raw.length) {
      break;
    }

    const keyStart = index;
    while (index < raw.length && raw[index] !== "=" && raw[index] !== "\n" && raw[index] !== "\r") {
      index += 1;
    }

    if (index >= raw.length || raw[index] !== "=") {
      index = skipLine(raw, index);
      continue;
    }

    const key = raw.slice(keyStart, index).trim();
    index += 1;

    if (!key) {
      index = skipLine(raw, index);
      continue;
    }

    const parsedValue = readEnvValue(raw, index);
    parsed[key] = parsedValue.value;
    index = parsedValue.nextIndex;
  }

  return parsed;
}

export function assertLocalWorkerOidcEnvironment(cloudflareDevVars: Record<string, string>): void {
  const environment = cloudflareDevVars.HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT?.trim();

  if (environment && environment !== "development") {
    throw new Error(
      [
        "apps/cloudflare/.dev.vars must set HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT=development for local `pnpm dev`.",
        `Current value: ${JSON.stringify(environment)}`,
      ].join(" "),
    );
  }
}

export function requireEnvValue(label: string, value: string | undefined, help: string): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new Error(`${label} is required for local hosted dev. ${help}`);
  }

  return normalized;
}

export function warnForMissingEnv(label: string, value: string | undefined): void {
  if (value?.trim()) {
    return;
  }

  process.stderr.write(
    `[setup] Warning: ${label} is not configured. The full hosted signup flow will stay incomplete until it is added.\n`,
  );
}

function resolveWranglerEnvValue(
  key: string,
  source: Readonly<Record<string, string | undefined>>,
): string | null {
  const value = source[key]?.trim();

  if (value) {
    return value;
  }

  if (key === "HOSTED_EXECUTION_RUNNER_ENV_PROFILES") {
    return "device-sync,hosted-email,linq,mapbox,telegram";
  }

  return null;
}

function skipWhitespaceAndComments(raw: string, startIndex: number): number {
  let index = startIndex;

  while (index < raw.length) {
    while (index < raw.length && (raw[index] === " " || raw[index] === "\t")) {
      index += 1;
    }

    if (raw[index] === "#") {
      index = skipLine(raw, index);
      continue;
    }

    if (raw[index] === "\n") {
      index += 1;
      continue;
    }

    if (raw[index] === "\r") {
      index += 1;
      if (raw[index] === "\n") {
        index += 1;
      }
      continue;
    }

    break;
  }

  return index;
}

function skipLine(raw: string, startIndex: number): number {
  let index = startIndex;

  while (index < raw.length && raw[index] !== "\n" && raw[index] !== "\r") {
    index += 1;
  }

  if (raw[index] === "\r") {
    index += 1;
  }
  if (raw[index] === "\n") {
    index += 1;
  }

  return index;
}

function readEnvValue(raw: string, startIndex: number): { nextIndex: number; value: string } {
  if (startIndex >= raw.length) {
    return { nextIndex: startIndex, value: "" };
  }

  const quote = raw[startIndex];
  if (quote === "\"" || quote === "'") {
    return readQuotedEnvValue(raw, startIndex + 1, quote);
  }

  let endIndex = startIndex;
  while (endIndex < raw.length && raw[endIndex] !== "\n" && raw[endIndex] !== "\r") {
    endIndex += 1;
  }

  const value = raw.slice(startIndex, endIndex).trim();
  return {
    nextIndex: skipLine(raw, endIndex),
    value,
  };
}

function readQuotedEnvValue(
  raw: string,
  startIndex: number,
  quote: "\"" | "'",
): { nextIndex: number; value: string } {
  let index = startIndex;
  let value = "";

  while (index < raw.length) {
    const character = raw[index];

    if (character === "\\") {
      const escaped = readEscapedCharacter(raw, index + 1, quote);
      value += escaped.value;
      index = escaped.nextIndex;
      continue;
    }

    if (character === quote) {
      const nextIndex = skipLine(raw, index + 1);
      return {
        nextIndex,
        value,
      };
    }

    value += character;
    index += 1;
  }

  return {
    nextIndex: index,
    value,
  };
}

function readEscapedCharacter(
  raw: string,
  startIndex: number,
  quote: "\"" | "'",
): { nextIndex: number; value: string } {
  if (startIndex >= raw.length) {
    return { nextIndex: startIndex, value: "\\" };
  }

  const character = raw[startIndex];

  if (character === quote || character === "\\") {
    return {
      nextIndex: startIndex + 1,
      value: character,
    };
  }

  if (quote === "\"") {
    if (character === "n") {
      return { nextIndex: startIndex + 1, value: "\n" };
    }

    if (character === "r") {
      return { nextIndex: startIndex + 1, value: "\r" };
    }

    if (character === "t") {
      return { nextIndex: startIndex + 1, value: "\t" };
    }
  }

  return {
    nextIndex: startIndex + 1,
    value: `\\${character}`,
  };
}

function isLoopbackHost(hostname: string): boolean {
  const normalizedHostname =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  return normalizedHostname === "127.0.0.1"
    || normalizedHostname === "localhost"
    || normalizedHostname === "::1";
}

function isPostgresProtocol(protocol: string): boolean {
  return protocol === "postgres:" || protocol === "postgresql:";
}

function isLoopbackPostgresUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return isPostgresProtocol(parsed.protocol) && isLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

function hasExplicitDatabaseName(pathname: string): boolean {
  return pathname !== "" && pathname !== "/";
}

async function tryReadTextFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return null;
    }

    throw error;
  }
}
