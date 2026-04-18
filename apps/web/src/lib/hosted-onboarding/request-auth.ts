import { type HostedMember, type PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import { readHostedMemberCoreState } from "./hosted-member-store";
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

export interface PrivyMemberAuthContext {
  identity: HostedPrivyIdentity;
  linkedAccounts: PrivyLinkedAccountLike[];
  memberLookup: HostedMemberPrivyIdentityLookup | null;
  member: HostedMember | null;
  verifiedPrivyUser: HostedPrivyUser;
}

export interface PrivySessionContext {
  identity: HostedPrivyIdentity;
  linkedAccounts: PrivyLinkedAccountLike[];
  memberId: string | null;
  verifiedPrivyUser: HostedPrivyUser;
}

export interface AuthenticatedPrivyMemberAuthContext extends Omit<PrivyMemberAuthContext, "member"> {
  member: HostedMember;
}

export async function getPrivySession(
  request: Request,
): Promise<PrivySessionContext | null> {
  const session = await resolveHostedPrivySessionFromRequest(request);

  if (!session) {
    return null;
  }

  return {
    identity: session.identity,
    linkedAccounts: session.linkedAccounts,
    memberId: session.memberId,
    verifiedPrivyUser: session.verifiedPrivyUser,
  };
}

export async function resolvePrivyMemberAuthFromSession(input: {
  identity: HostedPrivyIdentity;
  memberId: string | null;
  prisma: PrismaClient;
}): Promise<{
  member: HostedMember | null;
  memberLookup: HostedMemberPrivyIdentityLookup | null;
}> {
  if (input.memberId) {
    const member = await readHostedMemberCoreState({
      memberId: input.memberId,
      prisma: input.prisma,
    });

    if (member) {
      return {
        member,
        memberLookup: null,
      };
    }
  }

  const memberLookup = await lookupHostedMemberForPrivyIdentity({
    identity: input.identity,
    parallelizeReads: true,
    prisma: input.prisma,
  });

  return {
    member: memberLookup?.core ?? null,
    memberLookup,
  };
}

export async function getPrivyMemberAuth(
  request: Request,
  prisma: PrismaClient = getPrisma(),
): Promise<PrivyMemberAuthContext | null> {
  const session = await getPrivySession(request);

  if (!session) {
    return null;
  }

  const { member, memberLookup } = await resolvePrivyMemberAuthFromSession({
    identity: session.identity,
    memberId: session.memberId,
    prisma,
  });

  return {
    identity: session.identity,
    linkedAccounts: session.linkedAccounts,
    member,
    memberLookup,
    verifiedPrivyUser: session.verifiedPrivyUser,
  };
}

export async function requirePrivyMemberAuth(
  request: Request,
  prisma: PrismaClient = getPrisma(),
): Promise<AuthenticatedPrivyMemberAuthContext> {
  const context = await requireVerifiedPrivyMemberAuth(request, prisma);
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

export async function requireVerifiedPrivyMemberAuth(
  request: Request,
  prisma: PrismaClient = getPrisma(),
): Promise<PrivyMemberAuthContext> {
  const context = await getPrivyMemberAuth(request, prisma);

  if (!context) {
    throw hostedOnboardingError({
      code: "AUTH_REQUIRED",
      message: "Sign in to continue.",
      httpStatus: 401,
    });
  }

  return context;
}

export async function requirePrivySession(
  request: Request,
): Promise<PrivySessionContext> {
  const context = await getPrivySession(request);

  if (!context) {
    throw hostedOnboardingError({
      code: "AUTH_REQUIRED",
      message: "Sign in to continue.",
      httpStatus: 401,
    });
  }

  return context;
}

export async function requirePrivyCompletionSession(
  request: Request,
): Promise<PrivySessionContext> {
  try {
    return await requirePrivySession(request);
  } catch (error) {
    throw remapHostedPrivyCompletionLagError(error);
  }
}

export async function requireActivePrivyMemberAuth(
  request: Request,
  prisma: PrismaClient = getPrisma(),
): Promise<AuthenticatedPrivyMemberAuthContext> {
  const context = await requirePrivyMemberAuth(request, prisma);
  assertHostedMemberActiveAccessAllowed(context.member);
  return context;
}
