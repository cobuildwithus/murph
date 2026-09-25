import "server-only";
import { HostedOnboardingError } from "../hosted-onboarding/errors";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prepareHostedDomainRootForWeb } from "../hosted-crypto/domain-root-store";
import { readHostedMemberIdentity } from "../hosted-onboarding/hosted-member-identity-store";
import { readHostedMemberCoreState, readHostedMemberEmailAuthorization } from "../hosted-onboarding/hosted-member-store";
import { readHostedMemberRoutingState } from "../hosted-onboarding/hosted-member-routing-store";
import { assertHostedMemberNotSuspended } from "../hosted-onboarding/entitlement";
import { assertHostedPrivyAccountDeletionNotPending } from "../hosted-onboarding/member-identity-service";
import { readHostedPrivyUserById, resolveHostedPrivyIdentityFromVerifiedUser, type HostedPrivyIdentity } from "../hosted-onboarding/privy";
import { normalizeHostedEmailAddress } from "../hosted-onboarding/contact-privacy";
import { authLookupKey, openAuthRecord } from "./record-crypto";

type Client = PrismaClient | Prisma.TransactionClient;
export type HostedAuthUserFields = {
  email: string;
  emailVerified: boolean;
  phoneNumber?: string;
  phoneNumberVerified?: boolean;
  name: string;
  credentialsChangedAt: Date | null;
};

export class HostedAuthMigrationConflictError extends HostedOnboardingError {
  constructor() {
    super({ code: "AUTH_IDENTITY_RECONCILIATION_REQUIRED", httpStatus: 409, message: "Authentication identity needs reconciliation before migration." });
    this.name = "HostedAuthMigrationConflictError";
  }
}

// Exact ciphertext and authority timestamps are kept only in request memory.
// Unrelated billing, message delivery and routing activity do not stale a login.
export async function readHostedAuthSourceSnapshot(prisma: Client, memberId: string) {
  const [identity, email, telegram] = await Promise.all([
    prisma.hostedMemberIdentity.findUnique({ where: { memberId } }),
    prisma.hostedMemberEmailAuthorization.findUnique({ where: { memberId }, select: {
      verifiedEmailAddressEncrypted: true, verifiedEmailLookupKey: true, verifiedEmailVerifiedAt: true,
    } }),
    prisma.hostedMemberRouting.findUnique({ where: { memberId }, select: {
      telegramUserIdEncrypted: true,
    } }),
  ]);
  return JSON.stringify({ identity, email, telegram });
}

/**
 * Import admission needs independently refreshed provider evidence AND existing
 * canonical bindings. It never creates a member, promotes routing contacts, or
 * accepts provider-only accounts. A caller commits under the member/contact
 * locks after rechecking this exact source and the absence of a handoff.
 */
export async function prepareHostedAuthImport(input: { memberId: string; prisma: PrismaClient }) {
  const { prisma, memberId } = input;
  const owned = await prisma.hostedAuthRecord.findUnique({ where: { model_id: { model: "user", id: memberId } } });
  if (owned) {
    await openAuthRecord(owned, prisma);
    return { kind: "already_owned" as const };
  }
  const member = await readHostedMemberCoreState({ memberId, prisma });
  if (!member) throw new HostedAuthMigrationConflictError();
  assertHostedMemberNotSuspended(member);
  const snapshot = await readHostedAuthSourceSnapshot(prisma, memberId);
  const [identity, email, routing] = await Promise.all([
    readHostedMemberIdentity({ memberId, prisma }),
    readHostedMemberEmailAuthorization({ memberId, prisma }),
    readHostedMemberRoutingState({ memberId, prisma }),
  ]);
  if (!identity?.privyUserId) return { kind: "unbound" as const };
  await assertHostedPrivyAccountDeletionNotPending({ prisma, privyUserId: identity.privyUserId });
  const provider = resolveHostedPrivyIdentityFromVerifiedUser(await readHostedPrivyUserById(
    identity.privyUserId, { maxRetries: 0, timeout: 5_000 },
  ));
  const verifiedEmail = email?.verifiedEmail ? normalizeHostedEmailAddress(email.verifiedEmail.address) : null;
  const verifiedPhone = identity.phoneNumberVerifiedAt ? identity.phoneNumber : null;
  const telegramUserId = routing?.telegramUserId ?? null;
  assertProviderImportBindings(provider, { privyUserId: identity.privyUserId, email: verifiedEmail, phone: verifiedPhone, telegramUserId });
  if ((!verifiedEmail && !verifiedPhone && !telegramUserId) || snapshot !== await readHostedAuthSourceSnapshot(prisma, memberId)) {
    throw new HostedAuthMigrationConflictError();
  }
  const preparedRoot = await prepareHostedDomainRootForWeb({
    domain: "control", prepareMissing: false, prisma, userId: memberId, reason: "hosted-auth.import",
  });
  const user: HostedAuthUserFields = {
    email: verifiedEmail ?? `${authLookupKey("user", "member-alias", memberId)}@auth.invalid`,
    emailVerified: Boolean(verifiedEmail), name: "", credentialsChangedAt: null,
    ...(verifiedPhone ? { phoneNumber: verifiedPhone, phoneNumberVerified: true } : {}),
  };
  return { kind: "prepared" as const, memberId, snapshot, preparedRoot, user, telegramUserId, privyUserId: identity.privyUserId };
}

function assertProviderImportBindings(provider: HostedPrivyIdentity, expected: {
  privyUserId: string; email: string | null; phone: string | null; telegramUserId: string | null;
}): void {
  const email = provider.email?.verifiedAt ? normalizeHostedEmailAddress(provider.email.address) : null;
  const phone = provider.phone?.verifiedAt ? provider.phone.number : null;
  if (provider.userId !== expected.privyUserId || email !== expected.email || phone !== expected.phone
    || (provider.telegram?.telegramUserId ?? null) !== expected.telegramUserId) {
    throw new HostedAuthMigrationConflictError();
  }
}
