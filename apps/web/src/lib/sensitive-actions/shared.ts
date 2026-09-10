import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";

export const SETTINGS_SENSITIVE_ACTION_KINDS = [
  "vault.export",
  "approval.passkey.enroll",
  "approval.recovery-key.rotate",
  // Legacy-only admission for Settings pages loaded before the deletion change.
  // The account-deletion route does not consume this authorization.
  "account.delete",
] as const;

export const SENSITIVE_ACTION_KINDS = [
  ...SETTINGS_SENSITIVE_ACTION_KINDS,
  "account.credential.change",
  "approval.passkey.recover",
  "assistant.action.approve",
] as const;

export type SettingsSensitiveActionKind =
  typeof SETTINGS_SENSITIVE_ACTION_KINDS[number];
export type SensitiveActionKind = typeof SENSITIVE_ACTION_KINDS[number];

export interface SensitiveActionChallengeResponse {
  expiresAt: string;
  message: string;
  token: string;
}

export type SensitiveActionAuthorization = {
  signature: `0x${string}`;
  token: string;
  method?: "wallet";
} | {
  method: "passkey";
  assertion: AuthenticationResponseJSON;
  token: string;
  signature?: never;
};

const SENSITIVE_ACTION_TOKEN_PATTERN = /^sac_[A-Za-z0-9_-]{32}$/u;
const SENSITIVE_ACTION_SIGNATURE_PATTERN = /^0x[0-9a-fA-F]{130}$/u;

export function isSensitiveActionKind(value: unknown): value is SensitiveActionKind {
  return typeof value === "string"
    && (SENSITIVE_ACTION_KINDS as readonly string[]).includes(value);
}

export function isSettingsSensitiveActionKind(
  value: unknown,
): value is SettingsSensitiveActionKind {
  return typeof value === "string"
    && (SETTINGS_SENSITIVE_ACTION_KINDS as readonly string[]).includes(value);
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
  if (!isSensitiveActionToken(authorization.token)) {
    return null;
  }
  if (authorization.method === "passkey") {
    const assertion = parseApprovalPasskeyAssertion(authorization.assertion);
    return assertion ? { method: "passkey", assertion, token: authorization.token } : null;
  }
  return (authorization.method === undefined || authorization.method === "wallet")
    && isSensitiveActionSignature(authorization.signature)
    ? { signature: authorization.signature, token: authorization.token }
    : null;
}

export function parseApprovalPasskeyAssertion(value: unknown): AuthenticationResponseJSON | null {
  if (!value || typeof value !== "object") return null;
  const id: unknown = Reflect.get(value, "id");
  const rawId: unknown = Reflect.get(value, "rawId");
  const type: unknown = Reflect.get(value, "type");
  const response: unknown = Reflect.get(value, "response");
  if (typeof id !== "string" || id.length === 0 || rawId !== id || type !== "public-key"
    || !response || typeof response !== "object") return null;
  const authenticatorData: unknown = Reflect.get(response, "authenticatorData");
  const clientDataJSON: unknown = Reflect.get(response, "clientDataJSON");
  const signature: unknown = Reflect.get(response, "signature");
  const userHandle: unknown = Reflect.get(response, "userHandle");
  if (typeof authenticatorData !== "string" || typeof clientDataJSON !== "string"
    || typeof signature !== "string"
    || (userHandle != null && typeof userHandle !== "string")) return null;
  return {
    id, rawId, type, clientExtensionResults: {},
    response: {
      authenticatorData, clientDataJSON, signature,
      ...(typeof userHandle === "string" ? { userHandle } : {}),
    },
  };
}

export type HostedSecureApprovalStatus = (
  | { status: "configured" }
  | { status: "needs_support" }
  | { status: "not_configured" }
  | { status: "unavailable" }
) & { method?: "passkey" | "initial" };
