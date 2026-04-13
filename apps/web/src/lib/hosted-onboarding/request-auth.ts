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

export interface HostedPrivyMemberAuthContext {
  identity: HostedPrivyIdentity;
  linkedAccounts: PrivyLinkedAccountLike[];
  memberLookup: HostedMemberPrivyIdentityLookup | null;
  member: HostedMember | null;
  verifiedPrivyUser: HostedPrivyUser;
}

export interface HostedPrivySessionAuthContext {
  identity: HostedPrivyIdentity;
  linkedAccounts: PrivyLinkedAccountLike[];
  verifiedPrivyUser: HostedPrivyUser;
}

export interface HostedPrivyAuthenticatedMemberAuthContext extends Omit<HostedPrivyMemberAuthContext, "member"> {
  member: HostedMember;
}

export async function resolveHostedPrivySessionAuth(
  request: Request,
): Promise<HostedPrivySessionAuthContext | null> {
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

export async function resolveHostedPrivyMemberAuth(
  request: Request,
  prisma: PrismaClient = getPrisma(),
): Promise<HostedPrivyMemberAuthContext | null> {
  const session = await resolveHostedPrivySessionAuth(request);

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

export async function requireHostedPrivyMemberAuth(
  request: Request,
  prisma: PrismaClient = getPrisma(),
): Promise<HostedPrivyAuthenticatedMemberAuthContext> {
  const context = await requireHostedPrivyVerifiedMemberAuth(request, prisma);
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

export async function requireHostedPrivyVerifiedMemberAuth(
  request: Request,
  prisma: PrismaClient = getPrisma(),
): Promise<HostedPrivyMemberAuthContext> {
  const context = await resolveHostedPrivyMemberAuth(request, prisma);

  if (!context) {
    throw hostedOnboardingError({
      code: "AUTH_REQUIRED",
      message: "Verify your phone to continue.",
      httpStatus: 401,
    });
  }

  return context;
}

export async function requireHostedPrivySessionAuth(
  request: Request,
): Promise<HostedPrivySessionAuthContext> {
  const context = await resolveHostedPrivySessionAuth(request);

  if (!context) {
    throw hostedOnboardingError({
      code: "AUTH_REQUIRED",
      message: "Verify your phone to continue.",
      httpStatus: 401,
    });
  }

  return context;
}

export async function requireHostedPrivyCompletionAuth(
  request: Request,
): Promise<HostedPrivySessionAuthContext> {
  try {
    return await requireHostedPrivySessionAuth(request);
  } catch (error) {
    throw remapHostedPrivyCompletionLagError(error);
  }
}

export async function requireHostedPrivyActiveMemberAuth(
  request: Request,
  prisma: PrismaClient = getPrisma(),
): Promise<HostedPrivyAuthenticatedMemberAuthContext> {
  const context = await requireHostedPrivyMemberAuth(request, prisma);
  assertHostedMemberActiveAccessAllowed(context.member);
  return context;
}
