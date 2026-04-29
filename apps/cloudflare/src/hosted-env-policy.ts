import {
  HOSTED_SHARED_INGRESS_ONLY_SECRET_ENV_NAMES,
  HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES,
} from "@murphai/assistant-runtime/hosted-assistant-env-constants";
import {
  buildHostedRuntimeForwardedEnv,
  HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV,
  HOSTED_RUNTIME_ENV_KEY_NAMES,
  HOSTED_RUNTIME_ENV_PROFILES_ENV,
  HOSTED_RUNTIME_FORWARDED_ENV_LOG_CATEGORY_KEYS,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  HOSTED_AI_USAGE_BILLING_MODE_ENV,
} from "@murphai/hosted-execution";

import type { StringEnvSource } from "./string-env.ts";

const OPERATOR_ONLY_RUNNER_BINARY_ENV_KEYS = [
  "FFMPEG_COMMAND",
  "FILE_COMMAND",
  "MUTOOL_COMMAND",
  "PDFINFO_COMMAND",
  "PDFTOPPM_COMMAND",
  "PDFTOTEXT_COMMAND",
  "QPDF_COMMAND",
  "WHISPER_COMMAND",
  "WHISPER_MODEL_PATH",
] as const;

const RUNNER_SECRET_PROCESS_CONTROL_KEYS = [
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
  "NODE_OPTIONS",
  "NODE_PATH",
] as const;

const RUNNER_SECRET_PROCESS_ENV_OVERRIDE_KEYS = [
  "ALL_PROXY",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TEMP",
  "TMP",
  "TMPDIR",
] as const;

const RUNNER_SECRET_PROCESS_CONTROL_KEY_SET = new Set<string>(
  RUNNER_SECRET_PROCESS_CONTROL_KEYS,
);

const DEFAULT_ALLOWED_RUNNER_SECRET_KEYS = [
  ...HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES,
] as const;

const DISALLOWED_RUNNER_SECRET_KEYS = new Set([
  ...OPERATOR_ONLY_RUNNER_BINARY_ENV_KEYS,
  ...RUNNER_SECRET_PROCESS_CONTROL_KEYS,
  ...RUNNER_SECRET_PROCESS_ENV_OVERRIDE_KEYS,
  ...HOSTED_SHARED_INGRESS_ONLY_SECRET_ENV_NAMES,
  "HOME",
  HOSTED_AI_USAGE_BILLING_MODE_ENV,
  "HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY",
  "HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED",
  // This is a platform metering secret forwarded by the assistant env profile,
  // not a member-supplied runner secret. Letting userEnv override it would
  // break stable anonymized Gateway reporting IDs.
  "HOSTED_AI_USAGE_REPORTING_SECRET",
  // This is a platform-owned HMAC key for non-identifying log correlation.
  "HOSTED_LOG_FINGERPRINT_SECRET",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_KEY_ID",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_KEYRING_JSON",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK",
  "HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY",
  "HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEYRING_JSON",
  "HOSTED_EXECUTION_CONTROL_TOKEN",
  "HOSTED_EXECUTION_CONTROL_TOKENS",
  "HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN",
  "HOSTED_EXECUTION_RUNNER_CONTROL_TOKENS",
  "HOSTED_WAKE_ENCRYPTION_KEY",
  "HOSTED_WAKE_ENCRYPTION_KEYRING_JSON",
  "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
  "CODEX_HOME",
  "NODE_ENV",
  "PATH",
  "PORT",
  "PWD",
  // The hosted Telegram token and base URLs are platform-owned. Letting
  // member-controlled runner secrets override them can redirect privileged
  // Bot API traffic to arbitrary endpoints.
  "TELEGRAM_API_BASE_URL",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_FILE_BASE_URL",
  "VAULT",
]);

const DISALLOWED_RUNNER_SECRET_PREFIXES = [
  "AGENTMAIL_",
  "CF_",
  "HOSTED_ASSISTANT_",
  "HOSTED_EMAIL_",
  "HOSTED_EXECUTION_",
  "HOSTED_WAKE_",
  "HOSTED_WEB_CALLBACK_SIGNING_",
  "NPM_CONFIG_",
  "npm_config_",
  "WRANGLER_",
];

export const HOSTED_EXECUTION_RUNNER_ENV_PROFILES_ENV = HOSTED_RUNTIME_ENV_PROFILES_ENV;
export const HOSTED_RUNNER_ENV_KEY_NAMES = HOSTED_RUNTIME_ENV_KEY_NAMES;

export const HOSTED_RUNNER_FORWARDED_ENV_LOG_CATEGORY_KEYS =
  HOSTED_RUNTIME_FORWARDED_ENV_LOG_CATEGORY_KEYS;

export const HOSTED_RUNNER_SECRET_LOG_CATEGORY_KEYS = {
  modelCredentialConfigured: HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES,
} as const;

type UnknownEnvSource = Readonly<Record<string, unknown>>;

export function isHostedRunnerSecretKeyAllowed(
  key: string,
  source: StringEnvSource = process.env,
): boolean {
  if (DISALLOWED_RUNNER_SECRET_KEYS.has(key)) {
    return false;
  }

  if (DISALLOWED_RUNNER_SECRET_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return false;
  }

  const allowedKeys = new Set([
    ...DEFAULT_ALLOWED_RUNNER_SECRET_KEYS,
    ...parseHostedEnvCsvList(source.HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS),
  ]);

  // Hosted runner secrets are execution-only. Product facts and
  // process-control variables must stay out of this payload.
  return allowedKeys.has(key);
}

export function isHostedRunnerProcessControlEnvKey(key: string): boolean {
  return RUNNER_SECRET_PROCESS_CONTROL_KEY_SET.has(key);
}

export function buildHostedRunnerContainerEnv(
  source: UnknownEnvSource,
): Record<string, string> {
  return buildHostedRuntimeForwardedEnv(source, {
    mapValue: ({ key, value }) =>
      rewriteHostedRunnerLoopbackUrlForContainer(key, value, source),
  });
}

export function buildHostedRunnerAmbientEnv(
  source: UnknownEnvSource,
): Record<string, string> {
  return buildHostedRuntimeForwardedEnv(source);
}

const CONTAINER_REWRITABLE_RUNNER_URL_KEYS = new Set([
  HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV,
  "LINQ_ATTACHMENT_CDN_BASE_URL",
  "LINQ_API_BASE_URL",
  "TELEGRAM_API_BASE_URL",
  "TELEGRAM_FILE_BASE_URL",
]);

export function rewriteHostedRunnerLoopbackUrlForContainer(
  key: string,
  value: string,
  source: UnknownEnvSource,
): string {
  if (!CONTAINER_REWRITABLE_RUNNER_URL_KEYS.has(key)) {
    return value;
  }

  const containerReachableHost = readContainerReachableHost(source);
  if (!containerReachableHost) {
    return value;
  }

  try {
    const url = new URL(value);
    if (!isLoopbackHostname(url.hostname)) {
      return value;
    }

    url.hostname = containerReachableHost;
    return url.toString();
  } catch {
    return value;
  }
}

function readContainerReachableHost(source: UnknownEnvSource): string | null {
  const localInternalProxyBaseUrl = normalizeStringEnvValue(
    source.HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL,
  );
  if (localInternalProxyBaseUrl) {
    try {
      const url = new URL(localInternalProxyBaseUrl);
      if (!isLoopbackHostname(url.hostname)) {
        return url.hostname;
      }
    } catch {
      // Ignore invalid bridge URLs and fall back to the explicit host alias, if present.
    }
  }

  return normalizeStringEnvValue(source.HOSTED_EXECUTION_RUNNER_HOST_ALIAS);
}
export function filterHostedRunnerSecrets(
  env: Readonly<Record<string, string>>,
  source: StringEnvSource = process.env,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(([key, value]) =>
      typeof value === "string"
      && value.length > 0
      && isHostedRunnerSecretKeyAllowed(key, source)
    ),
  );
}

export function summarizeHostedRunnerForwardedEnvLogCategories(
  source: Readonly<Record<string, string | undefined>>,
): Record<keyof typeof HOSTED_RUNNER_FORWARDED_ENV_LOG_CATEGORY_KEYS, boolean> {
  return summarizeHostedRunnerLogCategories(source, HOSTED_RUNNER_FORWARDED_ENV_LOG_CATEGORY_KEYS);
}

export function summarizeHostedRunnerSecretLogCategories(
  source: Readonly<Record<string, string | undefined>>,
): Record<keyof typeof HOSTED_RUNNER_SECRET_LOG_CATEGORY_KEYS, boolean> {
  return summarizeHostedRunnerLogCategories(source, HOSTED_RUNNER_SECRET_LOG_CATEGORY_KEYS);
}

function summarizeHostedRunnerLogCategories<TCategoryMap extends Record<string, readonly string[]>>(
  source: Readonly<Record<string, string | undefined>>,
  categories: TCategoryMap,
): Record<keyof TCategoryMap, boolean> {
  return Object.fromEntries(
    Object.entries(categories).map(([category, keys]) => [
      category,
      keys.some((key) => typeof source[key] === "string" && source[key]!.length > 0),
    ]),
  ) as Record<keyof TCategoryMap, boolean>;
}

function normalizeStringEnvValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function parseHostedEnvCsvList(
  value: string | undefined,
  normalize: (entry: string) => string = (entry) => entry.toUpperCase(),
): string[] {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => normalize(entry));
}
