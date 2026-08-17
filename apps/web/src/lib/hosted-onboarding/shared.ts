import { randomBytes } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { normalizeNullableString as normalizeHostedNullableString } from "../primitives";

export { maskPhoneNumber, normalizePhoneNumber, normalizePhoneNumberForCountry } from "./phone";

export type HostedOnboardingReadClient = PrismaClient | Prisma.TransactionClient;
export const HOSTED_ONBOARDING_TRANSACTION_OPTIONS = { maxWait: 5_000 } as const;

export async function lockHostedMemberRow(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  memberId: string,
  options: {
    timeoutMs?: number;
  } = {},
): Promise<void> {
  if (options.timeoutMs !== undefined) {
    await tx.$queryRaw`select set_config('lock_timeout', ${`${options.timeoutMs}ms`}, true)`;
  }
  await tx.$queryRaw`select 1 from "hosted_member" where "id" = ${memberId} for update`;
}

export async function readHostedMemberSuspensionAfterLockTx(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  memberId: string,
): Promise<"active" | "missing" | "suspended"> {
  const rows = await tx.$queryRaw<Array<{ suspendedAt: Date | null }>>`
    SELECT suspended_at AS "suspendedAt"
    FROM hosted_member
    WHERE id = ${memberId}
  `;
  const owner = rows[0];
  if (!owner) {
    return "missing";
  }
  return owner.suspendedAt ? "suspended" : "active";
}

export async function lockHostedMemberSponsoredAccessRows(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  memberId: string,
): Promise<void> {
  await tx.$queryRaw`
    select 1
    from "hosted_account_group_membership" as "membership"
    join "hosted_account_group" as "account_group"
      on "account_group"."id" = "membership"."group_id"
    where "membership"."member_id" = ${memberId}
      and "membership"."status" = 'active'
    order by "account_group"."id", "membership"."id"
    for update of "account_group", "membership"
  `;
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

export function generateHostedGroupJoinOfferGeneration(): string {
  return `hgrpjog_${randomBytes(12).toString("base64url")}`;
}

export function generateHostedGroupJoinOutreachId(): string {
  return `hgrpjoa_${randomBytes(12).toString("base64url")}`;
}

export function generateHostedVaultShareId(): string {
  return `hbvs_${randomBytes(12).toString("base64url")}`;
}

export function generateHostedAccountExitReasonId(): string {
  return `haer_${randomBytes(12).toString("base64url")}`;
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
