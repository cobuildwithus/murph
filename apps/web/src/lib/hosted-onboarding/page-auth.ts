import "server-only";

import { cache } from "react";

import { getPrisma } from "../prisma";
import { isHostedOnboardingError } from "./errors";
import { getHostedPrivySession, type HostedPrivySession } from "./hosted-session";
import { type HostedMemberCoreState } from "./hosted-member-store";
import { type PrivyLinkedAccountLike } from "./privy-shared";
import { type HostedMemberPrivyIdentityLookup } from "./member-identity-service";
import { resolvePrivyMemberAuthFromSession } from "./request-auth";

export interface HostedPageAuthSnapshot {
  authenticated: boolean;
  authenticatedMember: HostedMemberCoreState | null;
  linkedAccounts: PrivyLinkedAccountLike[];
  memberLookup: HostedMemberPrivyIdentityLookup | null;
  session: HostedPrivySession | null;
}

function buildAnonymousHostedPageAuthSnapshot(): HostedPageAuthSnapshot {
  return {
    authenticated: false,
    authenticatedMember: null,
    linkedAccounts: [],
    memberLookup: null,
    session: null,
  };
}

const resolveHostedPageAuthSnapshot = cache(async (): Promise<HostedPageAuthSnapshot> => {
  let session: HostedPrivySession | null;

  try {
    session = await getHostedPrivySession();
  } catch (error) {
    if (isHostedPageAuthSessionError(error)) {
      return buildAnonymousHostedPageAuthSnapshot();
    }

    throw error;
  }

  if (!session) {
    return buildAnonymousHostedPageAuthSnapshot();
  }

  const { memberLookup, member: authenticatedMember } = await resolvePrivyMemberAuthFromSession({
    identity: session.identity,
    memberId: session.memberId,
    prisma: getPrisma(),
  });

  return {
    authenticated: Boolean(authenticatedMember),
    authenticatedMember,
    linkedAccounts: authenticatedMember ? session.linkedAccounts : [],
    memberLookup,
    session,
  };
});

export async function getHostedPageAuthSnapshot(): Promise<HostedPageAuthSnapshot> {
  return resolveHostedPageAuthSnapshot();
}

function isHostedPageAuthSessionError(error: unknown): boolean {
  return isHostedOnboardingError(error) && error.code === "PRIVY_AUTH_FAILED";
}
