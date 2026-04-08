import { type HostedMember, type PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import {
  hasHostedMemberActiveAccess,
  isHostedMemberSuspended,
} from "./entitlement";
import { hostedOnboardingError } from "./errors";
import {
  lookupHostedMemberForPrivyIdentity,
  type HostedMemberPrivyIdentityLookup,
} from "./member-identity-service";
import {
  readHostedPrivyAccessTokenFromRequest,
  type HostedPrivyIdentity,
  type HostedPrivyUser,
  remapHostedPrivyCompletionLagError,
  verifyHostedPrivyAccessToken,
  readHostedPrivyIdentityTokenFromRequest,
  resolveHostedPrivyIdentityFromVerifiedUser,
  verifyHostedPrivyIdentityToken,
} from "./privy";
import { type PrivyLinkedAccountLike, resolveHostedPrivyLinkedAccounts } from "./privy-shared";

export interface HostedPrivyRequestAuthContext {
  identity: HostedPrivyIdentity;
  linkedAccounts: PrivyLinkedAccountLike[];
  memberLookup: HostedMemberPrivyIdentityLookup | null;
  member: HostedMember | null;
  verifiedPrivyUser: HostedPrivyUser;
}

export interface HostedPrivyAuthenticatedRequestContext extends Omit<HostedPrivyRequestAuthContext, "member"> {
  member: HostedMember;
}

export async function resolveHostedPrivyRequestAuthContext(
  request: Request,
  prisma: PrismaClient = getPrisma(),
): Promise<HostedPrivyRequestAuthContext | null> {
  const accessToken = readHostedPrivyAccessTokenFromRequest(request);
  const identityToken = readHostedPrivyIdentityTokenFromRequest(request);

  if (!accessToken && !identityToken) {
    return null;
  }

  if (!accessToken || !identityToken) {
    throw hostedOnboardingError({
      code: "AUTH_REQUIRED",
      message: "Verify your phone to continue.",
      httpStatus: 401,
    });
  }

  const [verifiedAccessToken, verifiedPrivyUser] = await Promise.all([
    verifyHostedPrivyAccessToken(accessToken),
    verifyHostedPrivyIdentityToken(identityToken),
  ]);

  if (verifiedAccessToken.userId !== verifiedPrivyUser.id) {
    throw hostedOnboardingError({
      code: "PRIVY_SESSION_MISMATCH",
      message: "This Privy session does not match the current hosted account. Reopen the latest invite and try again.",
      httpStatus: 403,
    });
  }

  const identity = resolveHostedPrivyIdentityFromVerifiedUser(verifiedPrivyUser);
  const memberLookup = await lookupHostedMemberForPrivyIdentity({
    identity,
    prisma,
  });

  return {
    identity,
    linkedAccounts: resolveHostedPrivyLinkedAccounts(verifiedPrivyUser),
    member: memberLookup?.core ?? null,
    memberLookup,
    verifiedPrivyUser,
  };
}

export async function requireHostedPrivyRequestAuthContext(
  request: Request,
  prisma: PrismaClient = getPrisma(),
): Promise<HostedPrivyAuthenticatedRequestContext> {
  const context = await requireHostedPrivyVerifiedRequestAuthContext(request, prisma);
  if (!context.member) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      message: "Finish signup from your latest Murph link before continuing.",
      httpStatus: 403,
    });
  }

  return {
    ...context,
    member: context.member,
  };
}

export async function requireHostedPrivyVerifiedRequestAuthContext(
  request: Request,
  prisma: PrismaClient = getPrisma(),
): Promise<HostedPrivyRequestAuthContext> {
  const context = await resolveHostedPrivyRequestAuthContext(request, prisma);

  if (!context) {
    throw hostedOnboardingError({
      code: "AUTH_REQUIRED",
      message: "Verify your phone to continue.",
      httpStatus: 401,
    });
  }

  return context;
}

export async function requireHostedPrivyCompletionRequestAuthContext(
  request: Request,
  prisma: PrismaClient = getPrisma(),
): Promise<HostedPrivyRequestAuthContext> {
  try {
    return await requireHostedPrivyVerifiedRequestAuthContext(request, prisma);
  } catch (error) {
    throw remapHostedPrivyCompletionLagError(error);
  }
}

export async function requireHostedPrivyActiveRequestAuthContext(
  request: Request,
  prisma: PrismaClient = getPrisma(),
): Promise<HostedPrivyAuthenticatedRequestContext> {
  const context = await requireHostedPrivyRequestAuthContext(request, prisma);
  assertHostedMemberActiveAccessAllowed(context.member);
  return context;
}

function assertHostedMemberActiveAccessAllowed(member: HostedMember): void {
  if (isHostedMemberSuspended(member.suspendedAt)) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_SUSPENDED",
      message: "This hosted account is suspended. Contact support to restore access.",
      httpStatus: 403,
    });
  }

  if (!hasHostedMemberActiveAccess({
    billingStatus: member.billingStatus,
    suspendedAt: member.suspendedAt,
  })) {
    throw hostedOnboardingError({
      code: "HOSTED_ACCESS_REQUIRED",
      message: "Finish hosted activation before continuing.",
      httpStatus: 403,
    });
  }
}
