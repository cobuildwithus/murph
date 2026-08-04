import {
  HOSTED_INFERENCE_AUTH_SECRET_MAX_CODE_POINTS,
  normalizeHostedInferenceEndpointUrl,
  normalizeHostedInferenceModel,
  requireHostedInferenceAuthKind,
  requireHostedInferenceContextWindowTokens,
  requireHostedInferenceProtocol,
  type HostedInferenceProtocol,
} from "@murphai/hosted-execution/assistant-inference";

import {
  HOSTED_INFERENCE_SECRET_SCHEMA,
  type HostedInferenceConnectionAuth,
  type HostedInferenceConnectionCandidate,
  type HostedInferenceConnectionSecret,
} from "./types";

export function parseHostedInferenceConnectionCandidate(
  value: unknown,
): HostedInferenceConnectionCandidate {
  const record = requireRecord(value, "Hosted inference connection");
  requireExactKeys(record, [
    "auth",
    "contextWindowTokens",
    "endpointUrl",
    "model",
    "protocol",
    "supportsImages",
  ]);
  const protocol = requireHostedInferenceProtocol(record.protocol);
  return {
    auth: parseHostedInferenceConnectionAuth(record.auth),
    contextWindowTokens: requireHostedInferenceContextWindowTokens(
      record.contextWindowTokens,
    ),
    endpointUrl: normalizeHostedInferenceEndpointUrl({
      protocol,
      value: record.endpointUrl,
    }),
    model: normalizeHostedInferenceModel(record.model),
    protocol,
    supportsImages: requireBoolean(
      record.supportsImages,
      "Hosted inference supportsImages",
    ),
  };
}

export function parseHostedInferenceConnectionSecret(input: {
  expectedProtocol?: HostedInferenceProtocol;
  value: unknown;
}): HostedInferenceConnectionSecret {
  const record = requireRecord(
    input.value,
    "Hosted inference connection secret",
  );
  if (record.schema !== HOSTED_INFERENCE_SECRET_SCHEMA) {
    throw new TypeError(
      `Hosted inference connection secret schema must be ${HOSTED_INFERENCE_SECRET_SCHEMA}.`,
    );
  }
  const protocol = requireHostedInferenceProtocol(record.protocol);
  if (input.expectedProtocol && protocol !== input.expectedProtocol) {
    throw new TypeError(
      "Hosted inference connection protocol does not match its encrypted configuration.",
    );
  }
  return {
    auth: parseHostedInferenceConnectionAuth(record.auth),
    endpointUrl: normalizeHostedInferenceEndpointUrl({
      protocol,
      value: record.endpointUrl,
    }),
    model: normalizeHostedInferenceModel(record.model),
    protocol,
    schema: HOSTED_INFERENCE_SECRET_SCHEMA,
  };
}

export function buildHostedInferenceConnectionSecret(
  candidate: HostedInferenceConnectionCandidate,
): HostedInferenceConnectionSecret {
  return {
    auth: candidate.auth,
    endpointUrl: candidate.endpointUrl,
    model: candidate.model,
    protocol: candidate.protocol,
    schema: HOSTED_INFERENCE_SECRET_SCHEMA,
  };
}

function parseHostedInferenceConnectionAuth(
  value: unknown,
): HostedInferenceConnectionAuth {
  const record = requireRecord(value, "Hosted inference auth");
  requireExactKeys(record, ["kind", "secret"]);
  const secret = requireTrimmedString(
    record.secret,
    "Hosted inference auth secret",
  );
  if (
    [...secret].length > HOSTED_INFERENCE_AUTH_SECRET_MAX_CODE_POINTS
    || /[\u0000\r\n]/u.test(secret)
  ) {
    throw new RangeError(
      `Hosted inference auth secret must contain at most ${HOSTED_INFERENCE_AUTH_SECRET_MAX_CODE_POINTS} safe code points.`,
    );
  }
  return {
    kind: requireHostedInferenceAuthKind(record.kind),
    secret,
  };
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }
  return value;
}

function requireTrimmedString(value: unknown, label: string): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value !== value.trim()
  ) {
    throw new TypeError(`${label} must be a non-empty trimmed string.`);
  }
  return value;
}

function requireRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  record: Record<string, unknown>,
  expected: readonly string[],
): void {
  const expectedKeys = new Set(expected);
  if (
    Object.keys(record).length !== expectedKeys.size
    || Object.keys(record).some((key) => !expectedKeys.has(key))
  ) {
    throw new TypeError("Hosted inference connection contains unknown fields.");
  }
}
