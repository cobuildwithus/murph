export type { HostedNativeMemberAuthStage } from "../better-auth/native-auth";
import { readHostedNativeMemberAuth, type HostedNativeMemberAuth, type HostedNativeMemberAuthOptions } from "../better-auth/native-auth";
import { type PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import {
  requireHostedAppSessionFromRequest,
  type HostedAppSession,
} from "./app-session";
import { type HostedMemberCoreState } from "./hosted-member-store";
import {
  assertActiveHostedMemberAccessAllowed,
} from "./member-access";
import { hostedOnboardingError } from "./errors";
import { lookupHostedMemberForPrivyPrincipal } from "./member-identity-service";
import {
  type HostedPrivyIdentity,
  type HostedPrivyUser,
  remapHostedPrivyCompletionLagError,
} from "./privy";
import { type PrivyLinkedAccountLike } from "./privy-shared";
import {
  type HostedPrivySession,
  resolveHostedPrivySessionFromRequest,
} from "./hosted-session";

export interface PrivyMemberAuthContext {
  identity: HostedPrivyIdentity;
  linkedAccounts: PrivyLinkedAccountLike[];
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
  prisma: PrismaClient;
}): Promise<HostedMemberCoreState | null> {
  return lookupHostedMemberForPrivyPrincipal({
    identity: input.identity,
    prisma: input.prisma,
  });
}

export async function getPrivyMemberAuth(
  request: Request,
  prisma: PrismaClient = getPrisma(),
): Promise<PrivyMemberAuthContext | null> {
  const session = await getPrivySession(request);

  if (!session) {
    return null;
  }

  const member = await resolvePrivyMemberAuthFromSession({
    identity: session.identity,
    prisma,
  });

  return {
    identity: session.identity,
    linkedAccounts: session.linkedAccounts,
    member,
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

// Native transport has no ambient cookie authority. The legacy verifier is
// read-only; only explicit signup/completion routes may create a member.
export async function requireActiveHostedMemberAuthFromBearerToken(
  request: Request,
  prisma: PrismaClient = getPrisma(),
): Promise<HostedNativeMemberAuth> {
  const context = await requireHostedMemberAuthFromBearerToken(request, prisma);
  await assertActiveHostedMemberAccessAllowed({ memberId: context.member.id, prisma });
  return context;
}

// Legal, account and authority-reducing operations remain available without an
// entitlement check. Product reads and new authority use the active wrapper.
export async function requireHostedMemberAuthFromBearerToken(
  request: Request,
  prisma: PrismaClient = getPrisma(),
  options: HostedNativeMemberAuthOptions = {},
): Promise<HostedNativeMemberAuth> {
  return readHostedNativeMemberAuth(request, prisma, options);
}

export async function requireFreshPrivyMemberAuthForHostedAppSession(
  request: Request,
  prisma: PrismaClient = getPrisma(),
): Promise<{
  appSession: HostedAppSession & { privyUserId: string };
  freshPrivy: AuthenticatedPrivyMemberAuthContext;
}> {
  const [appSession, freshPrivy] = await Promise.all([
    requireHostedAppSessionFromRequest(request),
    requireVerifiedPrivyMemberAuth(request, prisma),
  ]);

  if (
    freshPrivy.identity.userId !== appSession.privyUserId
    || (freshPrivy.member && freshPrivy.member.id !== appSession.member.id)
  ) {
    throw hostedOnboardingError({
      code: "PRIVY_SESSION_MEMBER_MISMATCH",
      message:
        "This Privy login does not match your current Murph session. Sign out and sign back in.",
      httpStatus: 409,
    });
  }

  // Account linking proves the fresh Privy identity before Murph can persist
  // its new login method, so the exact Privy-user match lets the app session
  // supply the already-authenticated hosted member during that handoff.
  return {
    appSession: { ...appSession, privyUserId: freshPrivy.identity.userId },
    freshPrivy: {
      ...freshPrivy,
      member: appSession.member,
    },
  };
}

export async function requireFreshActivePrivyMemberAuthForHostedAppSession(
  request: Request,
  prisma: PrismaClient = getPrisma(),
): Promise<{
  appSession: HostedAppSession & { privyUserId: string };
  freshPrivy: AuthenticatedPrivyMemberAuthContext;
}> {
  const context = await requireFreshPrivyMemberAuthForHostedAppSession(request, prisma);
  await assertActiveHostedMemberAccessAllowed({
    memberId: context.appSession.member.id,
    prisma,
  });
  return context;
}
