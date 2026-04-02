import type { HostedMember, PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import { hostedOnboardingError } from "./errors";
import { findHostedMemberForPrivyIdentity } from "./member-identity-service";
import {
  type HostedPrivyIdentity,
  type HostedPrivyUser,
  readHostedPrivyIdentityTokenFromRequest,
  resolveHostedPrivyIdentityFromVerifiedUser,
  verifyHostedPrivyIdentityToken,
} from "./privy";
import { type PrivyLinkedAccountLike, resolveHostedPrivyLinkedAccounts } from "./privy-shared";

export interface HostedPrivyRequestAuthContext {
  identity: HostedPrivyIdentity;
  linkedAccounts: PrivyLinkedAccountLike[];
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
  const identityToken = readHostedPrivyIdentityTokenFromRequest(request);

  if (!identityToken) {
    return null;
  }

  const verifiedPrivyUser = await verifyHostedPrivyIdentityToken(identityToken);
  const identity = resolveHostedPrivyIdentityFromVerifiedUser(verifiedPrivyUser);
  const member = await findHostedMemberForPrivyIdentity({
    identity,
    prisma,
  });

  return {
    identity,
    linkedAccounts: resolveHostedPrivyLinkedAccounts(verifiedPrivyUser),
    member,
    verifiedPrivyUser,
  };
}

export async function requireHostedPrivyRequestAuthContext(
  request: Request,
  prisma: PrismaClient = getPrisma(),
): Promise<HostedPrivyAuthenticatedRequestContext> {
  const context = await resolveHostedPrivyRequestAuthContext(request, prisma);

  if (!context) {
    throw hostedOnboardingError({
      code: "AUTH_REQUIRED",
      message: "Verify your phone to continue.",
      httpStatus: 401,
    });
  }

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
