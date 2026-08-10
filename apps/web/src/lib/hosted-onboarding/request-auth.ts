import { type PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import {
  requireHostedAppSessionFromRequest,
  type HostedAppSession,
} from "./app-session";
import { type HostedMemberCoreState } from "./hosted-member-store";
import {
  assertActiveHostedMemberAccessAllowed,
  assertHostedCompanionMemberAccessAllowed,
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
  resolveHostedPrivySessionFromBearerToken,
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

/**
 * Bearer-token variant of `requireActivePrivyMemberAuth` for native
 * (non-browser) Murph companion apps. The bearer token is
 * the Privy identity token and is verified through the same server-side
 * Privy verification path as cookie sessions; member resolution and the
 * active-access entitlement check are identical. There is intentionally no
 * cookie fallback, so these routes carry no browser ambient authority.
 */
export async function requireActivePrivyMemberAuthFromBearerToken(
  request: Request,
  prisma: PrismaClient = getPrisma(),
): Promise<AuthenticatedPrivyMemberAuthContext> {
  const context = await requirePrivyMemberAuthFromBearerToken(request, prisma);
  await assertActiveHostedMemberAccessAllowed({
    memberId: context.member.id,
    prisma,
  });

  return context;
}

/**
 * Companion bearer auth for the native shell and health-sync boundary. Paused
 * own billing remains eligible here, while suspension and every other inactive
 * billing state keep the canonical access error. Paid product authority must
 * continue to use the active wrapper above.
 */
export async function requireHostedCompanionMemberAuthFromBearerToken(
  request: Request,
  prisma: PrismaClient = getPrisma(),
): Promise<AuthenticatedPrivyMemberAuthContext> {
  const context = await requirePrivyMemberAuthFromBearerToken(request, prisma);
  await assertHostedCompanionMemberAccessAllowed({
    memberId: context.member.id,
    prisma,
  });

  return context;
}

/**
 * Native bearer-token member auth without an entitlement check. Keep this
 * narrower variant directly for authority-reducing operations such as
 * revoking a scoped credential, and for member-owned legal/account controls
 * such as reading or recording consent that must remain available independent
 * of entitlement. Protected product-data reads and authority issuance must use
 * the active wrapper above by default. Other callers may use this
 * identity-only variant only when they re-check active access and any required
 * consent inside a stronger owning transaction before the protected read or
 * write.
 */
export async function requirePrivyMemberAuthFromBearerToken(
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

  const member = await resolvePrivyMemberAuthFromSession({
    identity: session.identity,
    prisma,
  });

  if (!member) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      message: "Finish signup from your latest Murph link before continuing.",
      httpStatus: 403,
    });
  }

  return {
    identity: session.identity,
    linkedAccounts: session.linkedAccounts,
    member,
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
    appSession,
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
  appSession: HostedAppSession;
  freshPrivy: AuthenticatedPrivyMemberAuthContext;
}> {
  const context = await requireFreshPrivyMemberAuthForHostedAppSession(request, prisma);
  await assertActiveHostedMemberAccessAllowed({
    memberId: context.appSession.member.id,
    prisma,
  });
  return context;
}
