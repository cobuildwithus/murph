import { randomBytes } from "node:crypto";

import { normalizeNullableString as normalizeDeviceSyncNullableString, sha256Hex } from "../device-sync/shared";
import { maskPhoneNumber, normalizePhoneNumber } from "./phone";

const HOSTED_ONBOARDING_TRIGGER_PATTERNS = [
  /\bi\s*want\s*to\s*get\s*healthy\b/iu,
  /\bget\s*healthy\b/iu,
  /\bmurph\b/iu,
  /\bhealthy\s*bob\b/iu,
  /\bjoin\s+murph\b/iu,
  /\bjoin\s+(healthy\s*bob|get\s*healthy)\b/iu,
  /\bstart\s+murph\b/iu,
  /\bstart\s+(healthy\s*bob|get\s*healthy)\b/iu,
] as const;

export { maskPhoneNumber, normalizePhoneNumber } from "./phone";

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
        ? normalizeDeviceSyncNullableString(
            typeof (part as { value?: unknown }).value === "string" ? (part as { value?: string }).value : null,
          )
        : null;

      return value ? [value] : [];
    });

  return values.length > 0 ? values.join("\n") : null;
}

export function shouldStartHostedOnboarding(text: string | null | undefined): boolean {
  const normalized = normalizeDeviceSyncNullableString(text);

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

export function generateHostedSessionId(): string {
  return `hbs_${randomBytes(12).toString("base64url")}`;
}

export function generateHostedCheckoutId(): string {
  return `hbco_${randomBytes(12).toString("base64url")}`;
}

export function generateHostedRevnetIssuanceId(): string {
  return `hbrv_${randomBytes(12).toString("base64url")}`;
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

export function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" ? normalizeDeviceSyncNullableString(value) : null;
}
