import { randomBytes } from "node:crypto";

import { normalizeString, sha256Hex } from "../device-sync/shared";

const HOSTED_ONBOARDING_TRIGGER_PATTERNS = [
  /\bi\s*want\s*to\s*get\s*healthy\b/iu,
  /\bget\s*healthy\b/iu,
  /\bhealthy\s*bob\b/iu,
  /\bjoin\s+(healthy\s*bob|get\s*healthy)\b/iu,
  /\bstart\s+(healthy\s*bob|get\s*healthy)\b/iu,
] as const;

export function normalizePhoneNumber(value: string | null | undefined): string | null {
  const normalized = normalizeString(value);

  if (!normalized) {
    return null;
  }

  const compact = normalized.replace(/[\s().-]+/gu, "");
  const prefixed = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;

  if (/^\+[1-9]\d{6,14}$/u.test(prefixed)) {
    return prefixed;
  }

  if (/^[1-9]\d{6,14}$/u.test(prefixed)) {
    return `+${prefixed}`;
  }

  return null;
}

export function maskPhoneNumber(value: string | null | undefined): string {
  const normalized = normalizePhoneNumber(value);

  if (!normalized) {
    return "your number";
  }

  const visible = normalized.slice(-4);
  return `*** ${visible}`;
}

export function extractLinqTextMessage(input: unknown): string | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const record = input as { parts?: unknown };

  if (!Array.isArray(record.parts)) {
    return null;
  }

  const values = record.parts
    .flatMap((part) => {
      if (!part || typeof part !== "object") {
        return [];
      }

      const value = (part as { type?: unknown; value?: unknown }).type === "text"
        ? normalizeString(typeof (part as { value?: unknown }).value === "string" ? (part as { value?: string }).value : null)
        : null;

      return value ? [value] : [];
    });

  return values.length > 0 ? values.join("\n") : null;
}

export function shouldStartHostedOnboarding(text: string | null | undefined): boolean {
  const normalized = normalizeString(text);

  if (!normalized) {
    return false;
  }

  return HOSTED_ONBOARDING_TRIGGER_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function generateHostedMemberId(): string {
  return `hbm_${randomBytes(12).toString("base64url")}`;
}

export function generateHostedInviteId(): string {
  return `hbi_${randomBytes(12).toString("base64url")}`;
}

export function generateHostedInviteCode(): string {
  return randomBytes(15).toString("base64url");
}

export function generateHostedPasskeyId(): string {
  return `hbp_${randomBytes(12).toString("base64url")}`;
}

export function generateHostedPasskeyUserId(): string {
  return randomBytes(18).toString("base64url");
}

export function generateHostedSessionId(): string {
  return `hbs_${randomBytes(12).toString("base64url")}`;
}

export function generateHostedChallengeId(): string {
  return `hbc_${randomBytes(12).toString("base64url")}`;
}

export function generateHostedCheckoutId(): string {
  return `hbco_${randomBytes(12).toString("base64url")}`;
}

export function generateHostedSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashHostedSessionToken(value: string): string {
  return sha256Hex(value);
}

export function generateHostedBootstrapSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function inviteExpiresAt(now: Date, ttlHours: number): Date {
  return new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
}

export function sessionExpiresAt(now: Date, ttlDays: number): Date {
  return new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
}

export function challengeExpiresAt(now: Date): Date {
  return new Date(now.getTime() + 10 * 60 * 1000);
}

export function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" ? normalizeString(value) : null;
}
