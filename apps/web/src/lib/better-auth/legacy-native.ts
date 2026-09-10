import "server-only";
import type { PrismaClient } from "@prisma/client";
import { verifyHostedPrivyIdentityToken } from "../hosted-onboarding/privy";
import { lookupHostedMemberIdentityByPrivyUserId, projectHostedMemberIdentityState } from "../hosted-onboarding/hosted-member-identity-store";
import { assertHostedPrivyAccountDeletionNotPending } from "../hosted-onboarding/member-identity-service";
import { assertHostedMemberNotSuspended } from "../hosted-onboarding/entitlement";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { openAuthRecord } from "./record-crypto";

export type HostedNativeMemberAuthStage = "identity_token_verification" | "member_lookup";
export interface HostedNativeMemberAuthOptions {
  runStage?<T>(stage: HostedNativeMemberAuthStage, run: () => Promise<T>): Promise<T>;
}

// Legacy admission has no member creation, credential synchronization, invite,
// consent, grant or activation side effects. JWT contact claims are irrelevant:
// only the cryptographically verified, already-bound principal selects a member.
export async function resolveHostedLegacyNativeMember(input: {
  token: string;
  prisma: PrismaClient;
}, options: HostedNativeMemberAuthOptions = {}) {
  const runStage = options.runStage ?? ((_stage, run) => run());
  const principal = await runStage("identity_token_verification", () => verifyHostedPrivyIdentityToken(input.token));
  const expiresAt = readVerifiedTokenExpiry(input.token);
  return runStage("member_lookup", () => readLegacyMember(input.prisma, principal.id, expiresAt));
}

async function readLegacyMember(prisma: PrismaClient, privyUserId: string, expiresAt: Date) {
  await assertHostedPrivyAccountDeletionNotPending({ prisma, privyUserId });
  const match = await lookupHostedMemberIdentityByPrivyUserId({
    privyUserId, prisma,
  });
  // The blind index routes the read; encrypted identity proves the binding.
  if (!match || match.identity.privyUserId !== privyUserId) throw legacyNativeUnavailable();
  assertHostedMemberNotSuspended(match.core);
  const row = await prisma.hostedAuthRecord.findUnique({
    where: { model_id: { model: "user", id: match.core.id } },
  });
  if (row) {
    const user = await openAuthRecord(row, prisma);
    if (user.credentialsChangedAt !== null) throw legacyNativeUnavailable();
  }
  const identityRow = await prisma.hostedMemberIdentity.findUnique({ where: { memberId: match.core.id } });
  if (!identityRow || (await projectHostedMemberIdentityState(identityRow, prisma)).privyUserId !== privyUserId) throw legacyNativeUnavailable();
  return { member: match.core, privyUserId, expiresAt, userRow: row, identityRow };
}

function legacyNativeUnavailable() {
  return hostedOnboardingError({ code: "AUTH_REQUIRED", httpStatus: 401, message: "Sign in again to continue." });
}

function readVerifiedTokenExpiry(token: string): Date {
  // Parsing is deliberately AFTER the existing signature/audience verifier.
  // Expiry is rechecked at commit so slow import cannot extend stale authority.
  if (token.length > 8192) throw legacyNativeUnavailable();
  const parts = token.split(".");
  if (parts.length !== 3) throw legacyNativeUnavailable();
  const payload: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  if (!payload || typeof payload !== "object" || !("exp" in payload) || typeof payload.exp !== "number"
    || !Number.isSafeInteger(payload.exp)) throw legacyNativeUnavailable();
  const expiresAt = new Date(payload.exp * 1000);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) throw legacyNativeUnavailable();
  return expiresAt;
}
