export const HOSTED_INFERENCE_PROTOCOLS = [
  "responses",
  "chat_completions",
] as const;

export type HostedInferenceProtocol =
  (typeof HOSTED_INFERENCE_PROTOCOLS)[number];

export const HOSTED_INFERENCE_AUTH_KINDS = [
  "bearer",
  "api_key",
  "x_api_key",
] as const;

export type HostedInferenceAuthKind =
  (typeof HOSTED_INFERENCE_AUTH_KINDS)[number];

export const HOSTED_CUSTOM_INFERENCE_CONSUMER_VERSION = 1 as const;
export const HOSTED_CUSTOM_INFERENCE_CONSUMER_VERSION_QUERY =
  "customInferenceVersion" as const;
export const HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE =
  "murph-codex-0.147.0-portable-responses-v1" as const;
export const HOSTED_INFERENCE_CONTEXT_WINDOW_MIN_TOKENS = 8_192;
export const HOSTED_INFERENCE_CONTEXT_WINDOW_MAX_TOKENS = 2_000_000;
export const HOSTED_INFERENCE_MODEL_MAX_CODE_POINTS = 200;
export const HOSTED_INFERENCE_ENDPOINT_MAX_CODE_POINTS = 2_048;
export const HOSTED_INFERENCE_AUTH_SECRET_MAX_CODE_POINTS = 4_096;

const HOSTED_INFERENCE_ENDPOINT_ALLOWED_QUERY_KEY = "api-version";
const HOSTED_INFERENCE_ENDPOINT_ALLOWED_QUERY_VALUE_PATTERN =
  /^[A-Za-z0-9._-]{1,64}$/u;
const HOSTED_INFERENCE_ENDPOINT_DENIED_HOST_SUFFIXES = [
  ".internal",
  ".local",
  ".localhost",
  ".worker",
  ".withmurph.ai",
  ".justco.build",
] as const;
const HOSTED_INFERENCE_ENDPOINT_DENIED_EXACT_HOSTS = new Set([
  "localhost",
  "withmurph.ai",
  "justco.build",
]);
const HOSTED_INFERENCE_ENDPOINT_HOST_PATTERN =
  /^(?:xn--)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.(?:xn--)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u;
const HOSTED_INFERENCE_ENDPOINT_ENCODED_SEPARATOR_PATTERN =
  /%(?:2e|2f|5c)/iu;

export interface HostedAssistantCustomInferenceOverride {
  contextWindowTokens: number;
  modelAlias: string;
  protocol: HostedInferenceProtocol;
  revision: number;
  supportsImages: boolean;
  verificationProfile: string;
}

export function isHostedInferenceProtocol(
  value: unknown,
): value is HostedInferenceProtocol {
  return HOSTED_INFERENCE_PROTOCOLS.some((candidate) => candidate === value);
}

export function isHostedInferenceAuthKind(
  value: unknown,
): value is HostedInferenceAuthKind {
  return HOSTED_INFERENCE_AUTH_KINDS.some((candidate) => candidate === value);
}

export function isHostedCustomInferenceConsumerVersion(
  value: unknown,
): value is typeof HOSTED_CUSTOM_INFERENCE_CONSUMER_VERSION {
  return value === HOSTED_CUSTOM_INFERENCE_CONSUMER_VERSION
    || value === String(HOSTED_CUSTOM_INFERENCE_CONSUMER_VERSION);
}

export function buildHostedCustomInferenceModelAlias(revision: number): string {
  return `murph-custom-r${requireHostedInferenceRevision(revision)}`;
}

export function hostedInferenceOperationPathSuffix(
  protocol: HostedInferenceProtocol,
): string {
  return protocol === "responses" ? "/responses" : "/chat/completions";
}

export function normalizeHostedInferenceEndpointUrl(input: {
  protocol: HostedInferenceProtocol;
  value: unknown;
}): string {
  const value = requireHostedInferenceString(
    input.value,
    "Hosted inference endpointUrl",
  );
  if ([...value].length > HOSTED_INFERENCE_ENDPOINT_MAX_CODE_POINTS) {
    throw new RangeError(
      `Hosted inference endpointUrl must be at most ${HOSTED_INFERENCE_ENDPOINT_MAX_CODE_POINTS} code points.`,
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Hosted inference endpointUrl must be an absolute URL.");
  }
  if (url.protocol !== "https:") {
    throw new TypeError("Hosted inference endpointUrl must use HTTPS.");
  }
  if (url.port && url.port !== "443") {
    throw new TypeError("Hosted inference endpointUrl must use port 443.");
  }
  if (url.username || url.password) {
    throw new TypeError(
      "Hosted inference endpointUrl must not contain URL credentials.",
    );
  }
  if (url.hash) {
    throw new TypeError("Hosted inference endpointUrl must not contain a fragment.");
  }
  if (HOSTED_INFERENCE_ENDPOINT_ENCODED_SEPARATOR_PATTERN.test(url.pathname)) {
    throw new TypeError(
      "Hosted inference endpointUrl must not contain encoded path separators.",
    );
  }

  const hostname = url.hostname.toLowerCase();
  if (
    HOSTED_INFERENCE_ENDPOINT_DENIED_EXACT_HOSTS.has(hostname)
    || HOSTED_INFERENCE_ENDPOINT_DENIED_HOST_SUFFIXES.some((suffix) =>
      hostname.endsWith(suffix)
    )
    || hostname.endsWith(".")
    || isHostedInferenceIpLiteral(hostname)
    || !HOSTED_INFERENCE_ENDPOINT_HOST_PATTERN.test(hostname)
  ) {
    throw new TypeError(
      "Hosted inference endpointUrl must use a public DNS hostname.",
    );
  }

  const expectedSuffix = hostedInferenceOperationPathSuffix(input.protocol);
  if (!url.pathname.endsWith(expectedSuffix)) {
    throw new TypeError(
      `Hosted inference endpointUrl must end in ${expectedSuffix}.`,
    );
  }

  const queryEntries = [...url.searchParams.entries()];
  if (
    queryEntries.some(([key]) => key !== HOSTED_INFERENCE_ENDPOINT_ALLOWED_QUERY_KEY)
    || url.searchParams.getAll(HOSTED_INFERENCE_ENDPOINT_ALLOWED_QUERY_KEY).length > 1
  ) {
    throw new TypeError(
      "Hosted inference endpointUrl supports only one api-version query parameter.",
    );
  }
  const apiVersion = url.searchParams.get(
    HOSTED_INFERENCE_ENDPOINT_ALLOWED_QUERY_KEY,
  );
  if (
    apiVersion !== null
    && !HOSTED_INFERENCE_ENDPOINT_ALLOWED_QUERY_VALUE_PATTERN.test(apiVersion)
  ) {
    throw new TypeError(
      "Hosted inference endpointUrl api-version is invalid.",
    );
  }

  return url.toString();
}

export function normalizeHostedInferenceModel(value: unknown): string {
  const model = requireHostedInferenceString(value, "Hosted inference model");
  if (
    [...model].length > HOSTED_INFERENCE_MODEL_MAX_CODE_POINTS
    || /[\u0000-\u001f\u007f]/u.test(model)
  ) {
    throw new RangeError(
      `Hosted inference model must contain at most ${HOSTED_INFERENCE_MODEL_MAX_CODE_POINTS} safe code points.`,
    );
  }
  return model;
}

export function parseHostedAssistantCustomInferenceOverride(
  value: unknown,
): HostedAssistantCustomInferenceOverride {
  const record = requireHostedInferenceRecord(
    value,
    "Hosted custom inference override",
  );
  requireHostedInferenceExactKeys(record, [
    "contextWindowTokens",
    "modelAlias",
    "protocol",
    "revision",
    "supportsImages",
    "verificationProfile",
  ]);
  const revision = requireHostedInferenceRevision(record.revision);
  const modelAlias = requireHostedInferenceString(
    record.modelAlias,
    "Hosted custom inference override modelAlias",
  );
  const expectedModelAlias = buildHostedCustomInferenceModelAlias(revision);
  if (modelAlias !== expectedModelAlias) {
    throw new TypeError(
      `Hosted custom inference override modelAlias must be ${expectedModelAlias}.`,
    );
  }

  return {
    contextWindowTokens: requireHostedInferenceContextWindowTokens(
      record.contextWindowTokens,
    ),
    modelAlias,
    protocol: requireHostedInferenceProtocol(record.protocol),
    revision,
    supportsImages: requireHostedInferenceBoolean(
      record.supportsImages,
      "Hosted custom inference override supportsImages",
    ),
    verificationProfile: requireHostedInferenceString(
      record.verificationProfile,
      "Hosted custom inference override verificationProfile",
    ),
  };
}

export function requireHostedInferenceContextWindowTokens(
  value: unknown,
): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < HOSTED_INFERENCE_CONTEXT_WINDOW_MIN_TOKENS
    || value > HOSTED_INFERENCE_CONTEXT_WINDOW_MAX_TOKENS
  ) {
    throw new RangeError(
      `Hosted inference contextWindowTokens must be an integer from ${HOSTED_INFERENCE_CONTEXT_WINDOW_MIN_TOKENS} through ${HOSTED_INFERENCE_CONTEXT_WINDOW_MAX_TOKENS}.`,
    );
  }
  return value;
}

export function requireHostedInferenceProtocol(
  value: unknown,
): HostedInferenceProtocol {
  if (!isHostedInferenceProtocol(value)) {
    throw new TypeError(
      "Hosted inference protocol must be responses or chat_completions.",
    );
  }
  return value;
}

export function requireHostedInferenceAuthKind(
  value: unknown,
): HostedInferenceAuthKind {
  if (!isHostedInferenceAuthKind(value)) {
    throw new TypeError(
      "Hosted inference auth kind must be bearer, api_key, or x_api_key.",
    );
  }
  return value;
}

export function requireHostedInferenceRevision(value: unknown): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 1
  ) {
    throw new TypeError("Hosted inference revision must be a positive integer.");
  }
  return value;
}

function isHostedInferenceIpLiteral(hostname: string): boolean {
  const unwrapped = hostname.replace(/^\[/u, "").replace(/\]$/u, "");
  if (unwrapped.includes(":")) {
    return true;
  }
  const parts = unwrapped.split(".");
  return parts.length === 4
    && parts.every((part) => /^\d{1,3}$/u.test(part))
    && parts.every((part) => Number(part) >= 0 && Number(part) <= 255);
}

function requireHostedInferenceBoolean(
  value: unknown,
  label: string,
): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }
  return value;
}

function requireHostedInferenceString(
  value: unknown,
  label: string,
): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value !== value.trim()
  ) {
    throw new TypeError(`${label} must be a non-empty trimmed string.`);
  }
  return value;
}

function requireHostedInferenceRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireHostedInferenceExactKeys(
  record: Record<string, unknown>,
  expected: readonly string[],
): void {
  const expectedKeys = new Set(expected);
  if (
    Object.keys(record).length !== expectedKeys.size
    || Object.keys(record).some((key) => !expectedKeys.has(key))
  ) {
    throw new TypeError("Hosted custom inference override contains unknown fields.");
  }
}
