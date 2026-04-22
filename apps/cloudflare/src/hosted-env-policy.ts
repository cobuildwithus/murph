import {
  HOSTED_ASSISTANT_ALLOWED_API_KEY_ENV_NAMES,
  HOSTED_ASSISTANT_CONFIG_ENV_NAMES,
  HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS,
  HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES,
} from "@murphai/assistant-runtime/hosted-assistant-env-constants";
import {
  readHostedEmailCapabilities,
} from "@murphai/hosted-execution/hosted-email";

import type { StringEnvSource } from "./string-env.ts";

const OPERATOR_ONLY_RUNNER_BINARY_ENV_KEYS = [
  "FFMPEG_COMMAND",
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

const RUNNER_SECRET_PROCESS_CONTROL_KEY_SET = new Set<string>(
  RUNNER_SECRET_PROCESS_CONTROL_KEYS,
);

const DEFAULT_ALLOWED_RUNNER_SECRET_KEYS = [
  ...HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES,
] as const;

const DISALLOWED_RUNNER_SECRET_KEYS = new Set([
  ...OPERATOR_ONLY_RUNNER_BINARY_ENV_KEYS,
  ...RUNNER_SECRET_PROCESS_CONTROL_KEYS,
  "HOME",
  "HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY",
  "HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED",
  // This is a platform metering secret forwarded by the assistant env profile,
  // not a member-supplied runner secret. Letting userEnv override it would
  // break stable anonymized Gateway reporting IDs.
  "HOSTED_AI_USAGE_REPORTING_SECRET",
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
  "NODE_ENV",
  "PATH",
  "PORT",
  "PWD",
  "VAULT",
]);

const DISALLOWED_RUNNER_SECRET_PREFIXES = [
  "AGENTMAIL_",
  "CF_",
  "HOSTED_ASSISTANT_",
  "HOSTED_EMAIL_",
  "HOSTED_EXECUTION_",
  "WRANGLER_",
];

export const HOSTED_EXECUTION_RUNNER_ENV_PROFILES_ENV =
  "HOSTED_EXECUTION_RUNNER_ENV_PROFILES";

// Hosted device-sync runtime config travels through resolvedConfig rather than
// raw child-process env forwarding.
const RUNNER_ENV_PROFILE_KEYS = {
  assistant: [
    ...HOSTED_ASSISTANT_ALLOWED_API_KEY_ENV_NAMES,
    "HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY",
    "HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED",
    "HOSTED_ASSISTANT_ZERO_DATA_RETENTION",
    "HOSTED_AI_USAGE_REPORTING_SECRET",
    "NODE_ENV",
    ...HOSTED_ASSISTANT_CONFIG_ENV_NAMES,
  ],
  "hosted-email": HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS.hostedEmailConfigured,
  linq: HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS.linqConfigured,
  mapbox: [
    "MAPBOX_ACCESS_TOKEN",
  ],
  parsers: HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS.parserToolingConfigured,
  telegram: HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS.telegramConfigured,
  web: [
    "BRAVE_API_KEY",
    "MURPH_WEB_FETCH_ENABLED",
    "MURPH_WEB_SEARCH_MAX_RESULTS",
    "MURPH_WEB_SEARCH_PROVIDER",
    "MURPH_WEB_SEARCH_TIMEOUT_MS",
  ],
} as const;

export const HOSTED_RUNNER_ENV_KEY_NAMES: readonly string[] = Array.from(
  new Set(Object.values(RUNNER_ENV_PROFILE_KEYS).flatMap((keys) => [...keys])),
);

const DEFAULT_RUNNER_ENV_PROFILE_NAMES = [
  "assistant",
  "parsers",
  "web",
] as const satisfies readonly RunnerEnvProfileName[];

export const HOSTED_RUNNER_FORWARDED_ENV_LOG_CATEGORY_KEYS =
  HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS;

export const HOSTED_RUNNER_SECRET_LOG_CATEGORY_KEYS = {
  modelCredentialConfigured: HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES,
} as const;

type RunnerEnvProfileName = keyof typeof RUNNER_ENV_PROFILE_KEYS;
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
  return buildHostedRunnerEnv(source, {
    rewriteLoopbackUrlsForContainer: true,
  });
}

export function buildHostedRunnerAmbientEnv(
  source: UnknownEnvSource,
): Record<string, string> {
  return buildHostedRunnerEnv(source, {
    rewriteLoopbackUrlsForContainer: false,
  });
}

function buildHostedRunnerEnv(
  source: UnknownEnvSource,
  options: {
    rewriteLoopbackUrlsForContainer: boolean;
  },
): Record<string, string> {
  const values: Record<string, string> = {};
  const enabledProfileNames = resolveHostedRunnerEnvProfileNames(source);
  const allowedKeys = resolveHostedRunnerEnvKeys(enabledProfileNames);

  for (const [key, value] of Object.entries(source)) {
    if (
      typeof value !== "string"
      || value.length === 0
      || !allowedKeys.has(key)
    ) {
      continue;
    }

    values[key] = options.rewriteLoopbackUrlsForContainer
      ? rewriteHostedRunnerLoopbackUrlForContainer(key, value, source)
      : value;
  }

  if (!values.NODE_ENV) {
    values.NODE_ENV = "production";
  }

  const emailCapabilities = enabledProfileNames.has("hosted-email")
    ? readHostedEmailCapabilities(source)
    : {
        ingressReady: false,
        sendReady: false,
      };
  values.HOSTED_EMAIL_INGRESS_READY = emailCapabilities.ingressReady ? "true" : "false";
  values.HOSTED_EMAIL_SEND_READY = emailCapabilities.sendReady ? "true" : "false";

  return values;
}

const CONTAINER_REWRITABLE_RUNNER_URL_KEYS = new Set([
  "HOSTED_ASSISTANT_BASE_URL",
  "LINQ_API_BASE_URL",
  "TELEGRAM_API_BASE_URL",
  "TELEGRAM_FILE_BASE_URL",
]);

function rewriteHostedRunnerLoopbackUrlForContainer(
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

function resolveHostedRunnerEnvProfileNames(
  source: UnknownEnvSource,
): Set<RunnerEnvProfileName> {
  const enabledProfiles = new Set<RunnerEnvProfileName>(
    DEFAULT_RUNNER_ENV_PROFILE_NAMES,
  );
  const configuredProfiles = parseHostedEnvCsvList(
    typeof source[HOSTED_EXECUTION_RUNNER_ENV_PROFILES_ENV] === "string"
      ? source[HOSTED_EXECUTION_RUNNER_ENV_PROFILES_ENV]
      : undefined,
    (entry) => entry.toLowerCase(),
  );

  for (const profileName of configuredProfiles) {
    if (isRunnerEnvProfileName(profileName)) {
      enabledProfiles.add(profileName);
    }
  }

  return enabledProfiles;
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

function resolveHostedRunnerEnvKeys(
  profileNames: ReadonlySet<RunnerEnvProfileName>,
): Set<string> {
  const keys = new Set<string>();

  for (const profileName of profileNames) {
    for (const key of RUNNER_ENV_PROFILE_KEYS[profileName]) {
      keys.add(key);
    }
  }

  return keys;
}

function isRunnerEnvProfileName(value: string): value is RunnerEnvProfileName {
  return Object.hasOwn(RUNNER_ENV_PROFILE_KEYS, value);
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
