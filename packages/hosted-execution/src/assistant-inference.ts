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
export const HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE =
  "murph-codex-0.145.0-portable-responses-v1" as const;
export const HOSTED_INFERENCE_CONTEXT_WINDOW_MIN_TOKENS = 8_192;
export const HOSTED_INFERENCE_CONTEXT_WINDOW_MAX_TOKENS = 2_000_000;
export const HOSTED_INFERENCE_MODEL_MAX_CODE_POINTS = 200;
export const HOSTED_INFERENCE_ENDPOINT_MAX_CODE_POINTS = 2_048;

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

export function buildHostedCustomInferenceModelAlias(revision: number): string {
  return `murph-custom-r${requireHostedInferenceRevision(revision)}`;
}

export function parseHostedAssistantCustomInferenceOverride(
  value: unknown,
): HostedAssistantCustomInferenceOverride {
  const record = requireHostedInferenceRecord(
    value,
    "Hosted custom inference override",
  );
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

function requireHostedInferenceProtocol(
  value: unknown,
): HostedInferenceProtocol {
  if (!isHostedInferenceProtocol(value)) {
    throw new TypeError(
      "Hosted inference protocol must be responses or chat_completions.",
    );
  }
  return value;
}

function requireHostedInferenceRevision(value: unknown): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 1
  ) {
    throw new TypeError("Hosted inference revision must be a positive integer.");
  }
  return value;
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
