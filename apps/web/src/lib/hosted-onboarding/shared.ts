import { randomBytes } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { normalizeNullableString as normalizeDeviceSyncNullableString } from "../device-sync/shared";

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

export { maskPhoneNumber, normalizePhoneNumber, normalizePhoneNumberForCountry } from "./phone";

export type HostedOnboardingPrismaClient = PrismaClient | Prisma.TransactionClient;

export async function withHostedOnboardingTransaction<TResult>(
  prisma: HostedOnboardingPrismaClient,
  callback: (tx: Prisma.TransactionClient) => Promise<TResult>,
): Promise<TResult> {
  return "$transaction" in prisma
    ? prisma.$transaction((tx) => callback(tx))
    : callback(prisma);
}

export async function lockHostedMemberRow(
  tx: Prisma.TransactionClient,
  memberId: string,
): Promise<void> {
  await tx.$queryRaw`select 1 from "hosted_member" where "id" = ${memberId} for update`;
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

export function generateHostedCheckoutId(): string {
  return `hbco_${randomBytes(12).toString("base64url")}`;
}

export function generateHostedRevnetIssuanceId(): string {
  return `hbrv_${randomBytes(12).toString("base64url")}`;
}

export function generateHostedBootstrapSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function inviteExpiresAt(now: Date, ttlHours: number): Date {
  return new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
}

export function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" ? normalizeDeviceSyncNullableString(value) : null;
}
