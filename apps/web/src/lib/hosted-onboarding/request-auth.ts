import { type HostedMember, type PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import {
  assertHostedMemberActiveAccessAllowed,
} from "./entitlement";
import { hostedOnboardingError } from "./errors";
import {
  lookupHostedMemberForPrivyIdentity,
  type HostedMemberPrivyIdentityLookup,
} from "./member-identity-service";
import {
  type HostedPrivyIdentity,
  type HostedPrivyUser,
  remapHostedPrivyCompletionLagError,
} from "./privy";
import { type PrivyLinkedAccountLike } from "./privy-shared";
import { resolveHostedPrivySessionFromRequest } from "./hosted-session";

export interface HostedPrivyRequestAuthContext {
  identity: HostedPrivyIdentity;
  linkedAccounts: PrivyLinkedAccountLike[];
  memberLookup: HostedMemberPrivyIdentityLookup | null;
  member: HostedMember | null;
  verifiedPrivyUser: HostedPrivyUser;
}

export interface HostedPrivySessionRequestAuthContext {
  identity: HostedPrivyIdentity;
  linkedAccounts: PrivyLinkedAccountLike[];
  verifiedPrivyUser: HostedPrivyUser;
}

export interface HostedPrivyAuthenticatedRequestContext extends Omit<HostedPrivyRequestAuthContext, "member"> {
  member: HostedMember;
}

export async function resolveHostedPrivySessionRequestAuthContext(
  request: Request,
): Promise<HostedPrivySessionRequestAuthContext | null> {
  const session = await resolveHostedPrivySessionFromRequest(request);

  if (!session) {
    return null;
  }

  return {
    identity: session.identity,
    linkedAccounts: session.linkedAccounts,
    verifiedPrivyUser: session.verifiedPrivyUser,
  };
}

export async function resolveHostedPrivyRequestAuthContext(
  request: Request,
  prisma: PrismaClient = getPrisma(),
): Promise<HostedPrivyRequestAuthContext | null> {
  const session = await resolveHostedPrivySessionRequestAuthContext(request);

  if (!session) {
    return null;
  }

  const memberLookup = await lookupHostedMemberForPrivyIdentity({
    identity: session.identity,
    parallelizeReads: true,
    prisma,
  });

  return {
    identity: session.identity,
    linkedAccounts: session.linkedAccounts,
    member: memberLookup?.core ?? null,
    memberLookup,
    verifiedPrivyUser: session.verifiedPrivyUser,
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

export async function requireHostedPrivyVerifiedSessionRequestAuthContext(
  request: Request,
): Promise<HostedPrivySessionRequestAuthContext> {
  const context = await resolveHostedPrivySessionRequestAuthContext(request);

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
): Promise<HostedPrivySessionRequestAuthContext> {
  try {
    return await requireHostedPrivyVerifiedSessionRequestAuthContext(request);
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
