import "server-only";
import type { PrismaClient } from "@prisma/client";
import { verifyHostedPrivyIdentityToken } from "../hosted-onboarding/privy";
import { lookupHostedMemberIdentityByPrivyUserId } from "../hosted-onboarding/hosted-member-identity-store";
import { assertHostedPrivyAccountDeletionNotPending } from "../hosted-onboarding/member-identity-service";
import { assertHostedMemberNotSuspended } from "../hosted-onboarding/entitlement";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { openAuthRecord } from "./record-crypto";

// Legacy admission has no member creation, credential synchronization, invite,
// consent, grant or activation side effects. JWT contact claims are irrelevant:
// only the cryptographically verified, already-bound principal selects a member.
export async function resolveHostedLegacyNativeMember(input: {
  token: string;
  prisma: PrismaClient;
}) {
  const principal = await verifyHostedPrivyIdentityToken(input.token);
  const expiresAt = readVerifiedTokenExpiry(input.token);
  await assertHostedPrivyAccountDeletionNotPending({ prisma: input.prisma, privyUserId: principal.id });
  const match = await lookupHostedMemberIdentityByPrivyUserId({
    privyUserId: principal.id, prisma: input.prisma,
  });
  // The blind index routes the read; encrypted identity proves the binding.
  if (!match || match.identity.privyUserId !== principal.id) throw legacyNativeUnavailable();
  assertHostedMemberNotSuspended(match.core);
  const row = await input.prisma.hostedAuthRecord.findUnique({
    where: { model_id: { model: "user", id: match.core.id } },
  });
  if (row) {
    const user = await openAuthRecord(row, input.prisma);
    if (user.credentialsChangedAt !== null) throw legacyNativeUnavailable();
  }
  return { member: match.core, privyUserId: principal.id, expiresAt, userRow: row };
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
