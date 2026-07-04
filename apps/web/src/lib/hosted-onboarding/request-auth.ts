import { type PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import {
  requireHostedAppSessionFromRequest,
  type HostedAppSession,
} from "./app-session";
import {
  readHostedMemberCoreState,
  type HostedMemberCoreState,
} from "./hosted-member-store";
import {
  assertActiveHostedMemberAccessAllowed,
} from "./member-access";
import { hostedOnboardingError } from "./errors";
import {
  lookupHostedMemberForPrivyPrincipal,
  type HostedMemberPrivyIdentityLookup,
} from "./member-identity-service";
import {
  type HostedPrivyIdentity,
  type HostedPrivyUser,
  remapHostedPrivyCompletionLagError,
} from "./privy";
import { type PrivyLinkedAccountLike } from "./privy-shared";
import {
  type HostedPrivySession,
  resolveHostedPrivySessionFromBearerToken,
  resolveHostedPrivySessionFromRequest,
} from "./hosted-session";

export interface PrivyMemberAuthContext {
  identity: HostedPrivyIdentity;
  linkedAccounts: PrivyLinkedAccountLike[];
  memberLookup: HostedMemberPrivyIdentityLookup | null;
  member: HostedMemberCoreState | null;
  verifiedPrivyUser: HostedPrivyUser;
}

export type PrivySessionContext = HostedPrivySession;

export interface AuthenticatedPrivyMemberAuthContext extends Omit<PrivyMemberAuthContext, "member"> {
  member: HostedMemberCoreState;
}

export async function getPrivySession(
  request: Request,
): Promise<PrivySessionContext | null> {
  return resolveHostedPrivySessionFromRequest(request);
}

export async function resolvePrivyMemberAuthFromSession(input: {
  identity: HostedPrivyIdentity;
  memberId: string | null;
  prisma: PrismaClient;
}): Promise<{
  member: HostedMemberCoreState | null;
  memberLookup: HostedMemberPrivyIdentityLookup | null;
}> {
  const [memberLookup, sessionMember] = await Promise.all([
    lookupHostedMemberForPrivyPrincipal({
      identity: input.identity,
      prisma: input.prisma,
    }),
    input.memberId
      ? readHostedMemberCoreState({
          memberId: input.memberId,
          prisma: input.prisma,
        })
      : Promise.resolve(null),
  ]);

  if (!input.memberId) {
    return {
      member: memberLookup?.core ?? null,
      memberLookup,
    };
  }

  if (!memberLookup) {
    return {
      member: null,
      memberLookup: null,
    };
  }

  if (!sessionMember || sessionMember.id !== memberLookup.core.id) {
    return {
      member: memberLookup.core,
      memberLookup,
    };
  }

  return {
    member: sessionMember,
    memberLookup: null,
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
  await assertActiveHostedMemberAccessAllowed({
    memberId: context.member.id,
    prisma,
  });
  return context;
}

/**
 * Bearer-token variant of `requireActivePrivyMemberAuth` for native
 * (non-browser) clients such as the iOS companion app. The bearer token is
 * the Privy identity token and is verified through the same server-side
 * Privy verification path as cookie sessions; member resolution and the
 * active-access entitlement check are identical. There is intentionally no
 * cookie fallback, so these routes carry no browser ambient authority.
 */
export async function requireActivePrivyMemberAuthFromBearerToken(
  request: Request,
  prisma: PrismaClient = getPrisma(),
): Promise<AuthenticatedPrivyMemberAuthContext> {
  const session = await resolveHostedPrivySessionFromBearerToken(request);

  if (!session) {
    throw hostedOnboardingError({
      code: "AUTH_REQUIRED",
      message: "Sign in to continue.",
      httpStatus: 401,
    });
  }

  const { member, memberLookup } = await resolvePrivyMemberAuthFromSession({
    identity: session.identity,
    memberId: session.memberId,
    prisma,
  });

  if (!member) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      message: "Finish signup from your latest Murph link before continuing.",
      httpStatus: 403,
    });
  }

  await assertActiveHostedMemberAccessAllowed({
    memberId: member.id,
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

export async function requireFreshPrivyMemberAuthForHostedAppSession(
  request: Request,
  prisma: PrismaClient = getPrisma(),
): Promise<{
  appSession: HostedAppSession;
  freshPrivy: AuthenticatedPrivyMemberAuthContext;
}> {
  const [appSession, freshPrivy] = await Promise.all([
    requireHostedAppSessionFromRequest(request),
    requirePrivyMemberAuth(request, prisma),
  ]);

  if (freshPrivy.member.id !== appSession.member.id) {
    throw hostedOnboardingError({
      code: "PRIVY_SESSION_MEMBER_MISMATCH",
      message:
        "This Privy login does not match your current Murph session. Sign out and sign back in.",
      httpStatus: 409,
    });
  }

  return { appSession, freshPrivy };
}

export async function requireFreshActivePrivyMemberAuthForHostedAppSession(
  request: Request,
  prisma: PrismaClient = getPrisma(),
): Promise<{
  appSession: HostedAppSession;
  freshPrivy: AuthenticatedPrivyMemberAuthContext;
}> {
  const context = await requireFreshPrivyMemberAuthForHostedAppSession(request, prisma);
  await Promise.all([
    assertActiveHostedMemberAccessAllowed({
      memberId: context.appSession.member.id,
      prisma,
    }),
    assertActiveHostedMemberAccessAllowed({
      memberId: context.freshPrivy.member.id,
      prisma,
    }),
  ]);
  return context;
}
