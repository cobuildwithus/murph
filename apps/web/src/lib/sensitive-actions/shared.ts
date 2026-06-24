export const SENSITIVE_ACTION_KINDS = [
  "vault.export",
  "account.delete",
] as const;

export type SensitiveActionKind = typeof SENSITIVE_ACTION_KINDS[number];

export interface SensitiveActionChallengeResponse {
  expiresAt: string;
  message: string;
  token: string;
}

export interface SensitiveActionAuthorization {
  signature: `0x${string}`;
  token: string;
}

const SENSITIVE_ACTION_TOKEN_PATTERN = /^sac_[A-Za-z0-9_-]{32}$/u;
const SENSITIVE_ACTION_SIGNATURE_PATTERN = /^0x[0-9a-fA-F]{130}$/u;

export function isSensitiveActionKind(value: unknown): value is SensitiveActionKind {
  return typeof value === "string"
    && (SENSITIVE_ACTION_KINDS as readonly string[]).includes(value);
}

export function isSensitiveActionToken(value: unknown): value is string {
  return typeof value === "string" && SENSITIVE_ACTION_TOKEN_PATTERN.test(value);
}

export function isSensitiveActionSignature(value: unknown): value is `0x${string}` {
  return typeof value === "string" && SENSITIVE_ACTION_SIGNATURE_PATTERN.test(value);
}

export function parseSensitiveActionAuthorization(
  value: unknown,
): SensitiveActionAuthorization | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const authorization = value as Record<string, unknown>;
  return isSensitiveActionToken(authorization.token)
    && isSensitiveActionSignature(authorization.signature)
    ? {
        signature: authorization.signature,
        token: authorization.token,
      }
    : null;
}
