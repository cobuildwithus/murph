import {
  HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE,
  HOSTED_INFERENCE_AUTH_SECRET_MAX_CODE_POINTS,
  normalizeHostedInferenceEndpointUrl,
  normalizeHostedInferenceModel,
  requireHostedInferenceAuthKind,
  requireHostedInferenceContextWindowTokens,
  requireHostedInferenceProtocol,
  type HostedInferenceAuthKind,
  type HostedInferenceProtocol,
} from "@murphai/hosted-execution/assistant-inference";

export const CLOUDFLARE_HOSTED_INFERENCE_VERIFICATION_BODY_MAX_BYTES =
  16 * 1024;

export interface CloudflareHostedInferenceVerificationRequest {
  auth: {
    kind: HostedInferenceAuthKind;
    secret: string;
  };
  contextWindowTokens: number;
  endpointUrl: string;
  model: string;
  protocol: HostedInferenceProtocol;
  supportsImages: boolean;
}

export interface CloudflareHostedInferenceVerificationResult {
  verificationProfile: typeof HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE;
  verified: true;
}

export function parseCloudflareHostedInferenceVerificationRequest(
  value: unknown,
): CloudflareHostedInferenceVerificationRequest {
  const record = requireRecord(value, "Custom inference verification request");
  requireExactKeys(record, [
    "auth",
    "contextWindowTokens",
    "endpointUrl",
    "model",
    "protocol",
    "supportsImages",
  ]);
  const protocol = requireHostedInferenceProtocol(record.protocol);
  const auth = requireRecord(
    record.auth,
    "Custom inference verification request auth",
  );
  requireExactKeys(auth, ["kind", "secret"]);
  const secret = requireTrimmedString(
    auth.secret,
    "Custom inference verification request auth secret",
  );
  if (
    [...secret].length > HOSTED_INFERENCE_AUTH_SECRET_MAX_CODE_POINTS
    || /[\u0000\r\n]/u.test(secret)
  ) {
    throw new RangeError(
      `Custom inference verification request auth secret must contain at most ${HOSTED_INFERENCE_AUTH_SECRET_MAX_CODE_POINTS} safe code points.`,
    );
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
    supportsImages: requireBoolean(
      record.supportsImages,
      "Custom inference verification request supportsImages",
    ),
  };
}

export function parseCloudflareHostedInferenceVerificationResult(
  value: unknown,
): CloudflareHostedInferenceVerificationResult {
  const record = requireRecord(value, "Custom inference verification result");
  requireExactKeys(record, ["verificationProfile", "verified"]);
  if (
    record.verified !== true
    || record.verificationProfile !== HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE
  ) {
    throw new TypeError("Custom inference verification result is invalid.");
  }
  return {
    verificationProfile: HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE,
    verified: true,
  };
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
    throw new TypeError("Custom inference verification value contains unknown fields.");
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
