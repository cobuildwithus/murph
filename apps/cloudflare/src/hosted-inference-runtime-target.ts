import {
  HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE,
  HOSTED_INFERENCE_AUTH_SECRET_MAX_CODE_POINTS,
  normalizeHostedInferenceEndpointUrl,
  normalizeHostedInferenceModel,
  requireHostedInferenceAuthKind,
  requireHostedInferenceContextWindowTokens,
  requireHostedInferenceProtocol,
  requireHostedInferenceRevision,
  type HostedInferenceAuthKind,
  type HostedInferenceProtocol,
} from "@murphai/hosted-execution/assistant-inference";

export const HOSTED_INFERENCE_RUNTIME_TARGET_SCHEMA =
  "murph.hosted-inference-runtime-target.v1" as const;

export interface HostedInferenceRuntimeTarget {
  auth: {
    kind: HostedInferenceAuthKind;
    secret: string;
  };
  contextWindowTokens: number;
  endpointUrl: string;
  model: string;
  protocol: HostedInferenceProtocol;
  revision: number;
  schema: typeof HOSTED_INFERENCE_RUNTIME_TARGET_SCHEMA;
  supportsImages: boolean;
  verificationProfile: string;
}

export function parseHostedInferenceRuntimeTarget(
  value: unknown,
): HostedInferenceRuntimeTarget {
  const record = requireRecord(value, "Hosted inference runtime target");
  requireExactKeys(record, [
    "auth",
    "contextWindowTokens",
    "endpointUrl",
    "model",
    "protocol",
    "revision",
    "schema",
    "supportsImages",
    "verificationProfile",
  ]);
  if (record.schema !== HOSTED_INFERENCE_RUNTIME_TARGET_SCHEMA) {
    throw new TypeError("Hosted inference runtime target schema is invalid.");
  }
  const protocol = requireHostedInferenceProtocol(record.protocol);
  const auth = requireRecord(record.auth, "Hosted inference runtime target auth");
  requireExactKeys(auth, ["kind", "secret"]);
  const secret = requireTrimmedString(
    auth.secret,
    "Hosted inference runtime target auth secret",
  );
  if ([...secret].length > HOSTED_INFERENCE_AUTH_SECRET_MAX_CODE_POINTS) {
    throw new RangeError(
      `Hosted inference runtime target auth secret must be at most ${HOSTED_INFERENCE_AUTH_SECRET_MAX_CODE_POINTS} code points.`,
    );
  }
  if (record.verificationProfile !== HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE) {
    throw new TypeError("Hosted inference runtime target verification profile is unsupported.");
  }

  return {
    auth: {
      kind: requireHostedInferenceAuthKind(auth.kind),
      secret,
    },
    contextWindowTokens: requireHostedInferenceContextWindowTokens(
      record.contextWindowTokens,
    ),
    endpointUrl: normalizeHostedInferenceEndpointUrl({
      protocol,
      value: record.endpointUrl,
    }),
    model: normalizeHostedInferenceModel(record.model),
    protocol,
    revision: requireHostedInferenceRevision(record.revision),
    schema: HOSTED_INFERENCE_RUNTIME_TARGET_SCHEMA,
    supportsImages: requireBoolean(
      record.supportsImages,
      "Hosted inference runtime target supportsImages",
    ),
    verificationProfile: HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE,
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
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
    throw new TypeError("Hosted inference runtime target contains unknown fields.");
  }
}

function requireTrimmedString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new TypeError(`${label} must be a non-empty trimmed string.`);
  }
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }
  return value;
}
