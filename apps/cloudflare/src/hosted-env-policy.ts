import {
  HOSTED_SHARED_INGRESS_ONLY_SECRET_ENV_NAMES,
  HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES,
  buildHostedRuntimeForwardedEnv,
  HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
  HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV,
  HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV,
  HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV,
  HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
  HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV,
  HOSTED_RUNTIME_FORWARDED_ENV_LOG_CATEGORY_KEYS,
} from "@murphai/assistant-runtime/hosted-runtime-worker-contracts";
import {
  HOSTED_ASSISTANT_WORKER_SECRET_ENV_NAMES,
} from "@murphai/hosted-execution/assistant-capabilities";
import {
  type StringEnvSource,
} from "./string-env.ts";
import {
  HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
} from "./runner-injected-credential.ts";

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
  "CODEX_CA_CERTIFICATE",
  "CURL_CA_BUNDLE",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "REQUESTS_CA_BUNDLE",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TEMP",
  "TMP",
  "TMPDIR",
] as const;

const RUNNER_SECRET_PROCESS_CONTROL_KEY_SET = new Set<string>(
  RUNNER_SECRET_PROCESS_CONTROL_KEYS,
);
const HOSTED_RUNNER_OPENAI_ASSISTANT_PROVIDER = "openai";
const HOSTED_RUNNER_VENICE_ASSISTANT_PROVIDER = "venice";
const HOSTED_RUNNER_OPENAI_API_KEY_ENV = "OPENAI_API_KEY";
const HOSTED_RUNNER_MURPH_DATA_API_KEY_ENV = "MURPH_DATA_API_KEY";
const HOSTED_RUNNER_PROVIDER_INTERCEPT_INJECTED_ENV_KEYS =
  HOSTED_ASSISTANT_WORKER_SECRET_ENV_NAMES;
const HOSTED_RUNNER_INTERCEPT_INJECTED_ENV_KEYS = new Set([
  ...HOSTED_RUNNER_PROVIDER_INTERCEPT_INJECTED_ENV_KEYS,
  ...HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES,
  HOSTED_RUNNER_MURPH_DATA_API_KEY_ENV,
]);

export const HOSTED_RUNNER_DEFAULT_ASSISTANT_PROVIDER =
  HOSTED_RUNNER_OPENAI_ASSISTANT_PROVIDER;
export const HOSTED_RUNNER_REQUIRED_ASSISTANT_PROVIDER =
  HOSTED_RUNNER_DEFAULT_ASSISTANT_PROVIDER;

export const HOSTED_RUNNER_DEPRECATED_CODEX_APP_SERVER_PROXY_ENV_KEYS = [
  HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV,
  HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV,
] as const;

const DEFAULT_ALLOWED_RUNNER_SECRET_KEYS = [] as const;

const DISALLOWED_RUNNER_SECRET_KEYS = new Set([
  ...HOSTED_RUNNER_INTERCEPT_INJECTED_ENV_KEYS,
  ...OPERATOR_ONLY_RUNNER_BINARY_ENV_KEYS,
  ...RUNNER_SECRET_PROCESS_CONTROL_KEYS,
  ...RUNNER_SECRET_PROCESS_ENV_OVERRIDE_KEYS,
  ...HOSTED_SHARED_INGRESS_ONLY_SECRET_ENV_NAMES,
  ...HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES,
  "HOME",
  // This is a platform metering secret forwarded by the assistant env profile,
  // not a member-supplied runner secret. Letting userEnv override it would
  // break stable anonymized usage reporting IDs.
  "HOSTED_AI_USAGE_REPORTING_SECRET",
  // This is a platform-owned HMAC key for non-identifying log correlation.
  "HOSTED_LOG_FINGERPRINT_SECRET",
  // This Worker-owned HMAC key signs hosted provider egress credentials. It
  // must never be forwarded to hosted runtime/user env.
  "HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET",
  // Platform-owned data API auth is injected by the Worker on matching hosted
  // web egress. The hosted container and member runner secrets must not carry it.
  "MURPH_DATA_API_KEY",
  // The private-media capability key encrypts provider-ingress lookup tokens
  // and derives per-user staging keys. It stays behind the write-fenced Worker
  // publisher and public capability-reader boundaries.
  "HOSTED_PRIVATE_MEDIA_CAPABILITY_SECRET",
  // This non-secret origin is platform-owned. Member runner secrets cannot
  // redirect Worker-authorized data API egress to arbitrary origins.
  "HOSTED_WEB_BASE_URL",
  // Image-pinned asset roots (Dockerfile ENV). Runner secrets must not
  // redirect package-owned generated assets or assistant assets to
  // member-controlled content. The same names are also denied at the runtime
  // config boundary (assistant-runtime environment sanitizers), so
  // non-Cloudflare job producers share the guard. Kept as literals here: this
  // module is part of the workerd bundle, which must not import owner package
  // Node-only module graphs. Node-side tests assert these literals equal the
  // owner-package constants.
  "MURPH_HEALTH_COMMONS_PACKAGE_ROOT",
  "MURPH_ASSISTANT_CLI_SURFACE_PREBUILT_ARTIFACT_PATH",
  "MURPH_ASSISTANT_SKILLS_ROOT",
  HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
  HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV,
  HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
  HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV,
  HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV,
  HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV,
  "HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION",
  "HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM",
  "HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON",
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID",
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK",
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON",
  "HOSTED_CRYPTO_ENV",
  "HOSTED_EXECUTION_CONTROL_TOKEN",
  "HOSTED_EXECUTION_CONTROL_TOKENS",
  "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
  "CODEX_HOME",
  "NODE_ENV",
  "PATH",
  "PORT",
  "PWD",
  // The hosted Telegram token and base URLs are platform-owned. Letting
  // member-controlled runner secrets override them can redirect privileged
  // provider API traffic to arbitrary endpoints.
  "TELEGRAM_API_BASE_URL",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_FILE_BASE_URL",
  "VAULT",
]);

const DISALLOWED_RUNNER_SECRET_PREFIXES = [
  "CF_",
  "HOSTED_ASSISTANT_",
  "HOSTED_CONTAINER_",
  "HOSTED_CRYPTO_",
  "HOSTED_EMAIL_",
  "HOSTED_EXECUTION_",
  "HOSTED_WEB_CALLBACK_SIGNING_",
  "NPM_CONFIG_",
  // Retired provider configuration remains permanently non-forwardable so a
  // stale deployed allowlist cannot expose old credentials to the runner.
  "WHATSAPP_",
  "npm_config_",
  "WRANGLER_",
];

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
  assertNoHostedRunnerDeprecatedCodexAppServerProxyEnv(source);
  assertHostedRunnerAssistantProvider(source);

  return buildHostedRuntimeForwardedEnv(source, {
    mapValue: ({ key, value }) => {
      if (HOSTED_RUNNER_INTERCEPT_INJECTED_ENV_KEYS.has(key)) {
        return HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL;
      }
      return rewriteHostedRunnerLoopbackUrlForContainer(key, value, source);
    },
  });
}

export function buildHostedRunnerAmbientEnv(
  source: UnknownEnvSource,
): Record<string, string> {
  assertNoHostedRunnerDeprecatedCodexAppServerProxyEnv(source);
  assertHostedRunnerAssistantProvider(source);

  return buildHostedRuntimeForwardedEnv(source);
}

const CONTAINER_REWRITABLE_RUNNER_URL_KEYS = new Set([
  HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV,
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
  const explicitAlias = normalizeStringEnvValue(source.HOSTED_EXECUTION_RUNNER_HOST_ALIAS);
  if (explicitAlias) {
    return explicitAlias;
  }

  return null;
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
): Record<keyof typeof HOSTED_RUNTIME_FORWARDED_ENV_LOG_CATEGORY_KEYS, boolean> {
  return summarizeHostedRunnerLogCategories(source, HOSTED_RUNTIME_FORWARDED_ENV_LOG_CATEGORY_KEYS);
}

export function summarizeHostedRunnerSecretLogCategories(
  source: Readonly<Record<string, string | undefined>>,
): Record<keyof typeof HOSTED_RUNNER_SECRET_LOG_CATEGORY_KEYS, boolean> {
  return summarizeHostedRunnerLogCategories(source, HOSTED_RUNNER_SECRET_LOG_CATEGORY_KEYS);
}

export function assertNoHostedRunnerDeprecatedCodexAppServerProxyEnv(
  source: Readonly<Record<string, unknown>>,
): void {
  const configuredKeys = readConfiguredHostedRunnerDeprecatedCodexAppServerProxyEnvKeys(
    source,
  );
  if (configuredKeys.length === 0) {
    return;
  }

  throw new TypeError(
    `${configuredKeys.join(", ")} are no longer supported for hosted runner config; configure HOSTED_ASSISTANT_PROVIDER=${HOSTED_RUNNER_DEFAULT_ASSISTANT_PROVIDER} with ${HOSTED_RUNNER_OPENAI_API_KEY_ENV} instead.`,
  );
}

export function isHostedRunnerSupportedAssistantProvider(
  value: unknown,
): boolean {
  return normalizeStringEnvValue(value) === HOSTED_RUNNER_REQUIRED_ASSISTANT_PROVIDER;
}

export function isHostedRunnerOpenAiProvider(value: unknown): boolean {
  return isHostedRunnerSupportedAssistantProvider(value);
}

export function isHostedRunnerVeniceProvider(value: unknown): boolean {
  return normalizeStringEnvValue(value) === HOSTED_RUNNER_VENICE_ASSISTANT_PROVIDER;
}

export function hasHostedRunnerModelCredential(input: {
  forwardedEnv?: Readonly<Record<string, string>> | null;
  userEnv?: Readonly<Record<string, string>> | null;
}): boolean {
  return HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES.some((envName) =>
    normalizeStringEnvValue(input.forwardedEnv?.[envName]) !== null
    || normalizeStringEnvValue(input.userEnv?.[envName]) !== null
  );
}

function assertHostedRunnerAssistantProvider(
  source: Readonly<Record<string, unknown>>,
): void {
  if (isHostedRunnerSupportedAssistantProvider(source.HOSTED_ASSISTANT_PROVIDER)) {
    return;
  }

  throw new TypeError(
    `HOSTED_ASSISTANT_PROVIDER must be ${HOSTED_RUNNER_REQUIRED_ASSISTANT_PROVIDER} for hosted runner execution.`,
  );
}

function readConfiguredHostedRunnerDeprecatedCodexAppServerProxyEnvKeys(
  source: Readonly<Record<string, unknown>>,
): string[] {
  return HOSTED_RUNNER_DEPRECATED_CODEX_APP_SERVER_PROXY_ENV_KEYS.filter((key) =>
    normalizeStringEnvValue(source[key]) !== null
  );
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
