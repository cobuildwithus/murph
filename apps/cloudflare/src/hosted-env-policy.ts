import {
  HOSTED_ASSISTANT_ALLOWED_API_KEY_ENV_NAMES,
  HOSTED_ASSISTANT_CONFIG_ENV_NAMES,
} from "@murphai/assistant-runtime/hosted-assistant-env";
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
  "ANTHROPIC_API_KEY",
  "BRAVE_API_KEY",
  "CEREBRAS_API_KEY",
  "DEEPSEEK_API_KEY",
  "FIREWORKS_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GROQ_API_KEY",
  "HF_TOKEN",
  "HUGGINGFACEHUB_API_TOKEN",
  "HUGGINGFACE_API_KEY",
  "HUGGING_FACE_HUB_TOKEN",
  "LITELLM_PROXY_API_KEY",
  "MISTRAL_API_KEY",
  "NVIDIA_API_KEY",
  "NGC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "PERPLEXITY_API_KEY",
  "TOGETHER_API_KEY",
  "VERCEL_AI_API_KEY",
  "VENICE_API_KEY",
  "XAI_API_KEY",
] as const;

const DISALLOWED_RUNNER_SECRET_KEYS = new Set([
  ...OPERATOR_ONLY_RUNNER_BINARY_ENV_KEYS,
  ...RUNNER_SECRET_PROCESS_CONTROL_KEYS,
  "HOME",
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
    "HOSTED_ASSISTANT_ZERO_DATA_RETENTION",
    "NODE_ENV",
    ...HOSTED_ASSISTANT_CONFIG_ENV_NAMES,
  ],
  "hosted-email": [
    "HOSTED_EMAIL_DOMAIN",
    "HOSTED_EMAIL_FROM_ADDRESS",
    "HOSTED_EMAIL_LOCAL_PART",
  ],
  linq: [
    "LINQ_API_BASE_URL",
    "LINQ_API_TOKEN",
    "LINQ_WEBHOOK_SECRET",
  ],
  mapbox: [
    "MAPBOX_ACCESS_TOKEN",
  ],
  parsers: [
    "FFMPEG_COMMAND",
    "WHISPER_COMMAND",
    "WHISPER_MODEL_PATH",
  ],
  telegram: [
    "TELEGRAM_API_BASE_URL",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_BOT_USERNAME",
    "TELEGRAM_FILE_BASE_URL",
  ],
  web: [
    "BRAVE_API_KEY",
    "MURPH_WEB_FETCH_ENABLED",
    "MURPH_WEB_SEARCH_MAX_RESULTS",
    "MURPH_WEB_SEARCH_PROVIDER",
    "MURPH_WEB_SEARCH_TIMEOUT_MS",
  ],
} as const;

const DEFAULT_RUNNER_ENV_PROFILE_NAMES = [
  "assistant",
  "parsers",
  "web",
] as const satisfies readonly RunnerEnvProfileName[];

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

export function normalizeHostedRunnerEnvForHostExecution(
  forwardedEnv: Readonly<Record<string, string>>,
  source: UnknownEnvSource,
): Record<string, string> {
  const normalized = { ...forwardedEnv };
  const rewriteHostnames = new Set<string>(["host.docker.internal"]);
  const containerReachableHost = readContainerReachableHost(source);

  if (containerReachableHost) {
    rewriteHostnames.add(containerReachableHost);
  }

  for (const [key, forwardedValue] of Object.entries(forwardedEnv)) {
    const ambientValue = normalizeHostedRunnerLoopbackUrlForHostExecution(
      key,
      source[key],
    );
    if (!ambientValue || typeof forwardedValue !== "string") {
      continue;
    }

    try {
      const forwardedUrl = new URL(forwardedValue);
      if (rewriteHostnames.has(forwardedUrl.hostname)) {
        normalized[key] = ambientValue;
      }
    } catch {
      continue;
    }
  }

  return normalized;
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

function normalizeHostedRunnerLoopbackUrlForHostExecution(
  key: string,
  value: unknown,
): string | null {
  if (!CONTAINER_REWRITABLE_RUNNER_URL_KEYS.has(key) || typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value);
    return isLoopbackHostname(url.hostname) ? value : null;
  } catch {
    return null;
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
