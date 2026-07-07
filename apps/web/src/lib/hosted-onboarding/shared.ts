import { randomBytes } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { normalizeNullableString as normalizeHostedNullableString } from "../primitives";

export { maskPhoneNumber, normalizePhoneNumber, normalizePhoneNumberForCountry } from "./phone";

export type HostedOnboardingReadClient = PrismaClient | Prisma.TransactionClient;
export const HOSTED_ONBOARDING_TRANSACTION_OPTIONS = { maxWait: 5_000 } as const;

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
        ? normalizeHostedNullableString(
            typeof (part as { value?: unknown }).value === "string" ? (part as { value?: string }).value : null,
          )
        : null;

      return value ? [value] : [];
    });

  return values.length > 0 ? values.join("\n") : null;
}

export function generateHostedMemberId(): string {
  return `hbm_${randomBytes(12).toString("base64url")}`;
}

export function generateHostedInviteId(): string {
  return `hbi_${randomBytes(12).toString("base64url")}`;
}

export function generateHostedAccountGroupId(): string {
  return `hbag_${randomBytes(12).toString("base64url")}`;
}

export function generateHostedAccountGroupMembershipId(): string {
  return `hbagm_${randomBytes(12).toString("base64url")}`;
}

export function generateHostedAccountGroupInviteId(): string {
  return `hbagi_${randomBytes(12).toString("base64url")}`;
}

export function generateHostedGroupId(): string {
  return `hgrp_${randomBytes(12).toString("base64url")}`;
}

export function generateHostedGroupMemberId(): string {
  return `hgrpm_${randomBytes(12).toString("base64url")}`;
}

export function generateHostedGroupJoinOfferId(): string {
  return `hgrpjo_${randomBytes(12).toString("base64url")}`;
}

export function generateHostedVaultShareId(): string {
  return `hbvs_${randomBytes(12).toString("base64url")}`;
}

export function generateHostedFamilyCheckoutAttemptId(): string {
  return `hbfca_${randomBytes(12).toString("base64url")}`;
}

export function generateHostedInviteCode(): string {
  return randomBytes(15).toString("base64url");
}

export function generateHostedGroupJoinCode(): string {
  return generateHostedInviteCode();
}

export function generateHostedPhoneCodeAttemptId(): string {
  return `hbpc_${randomBytes(12).toString("base64url")}`;
}

export function inviteExpiresAt(now: Date, ttlHours: number): Date {
  return new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
}

export function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" ? normalizeHostedNullableString(value) : null;
}
