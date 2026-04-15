import "server-only";

import { type HostedMember } from "@prisma/client";
import { cache } from "react";

import { getPrisma } from "../prisma";
import { isHostedOnboardingError } from "./errors";
import { lookupHostedMemberForPrivyIdentity, type HostedMemberPrivyIdentityLookup } from "./member-identity-service";
import { getHostedPrivySession, type HostedPrivySession } from "./hosted-session";
import { type PrivyLinkedAccountLike } from "./privy-shared";

export interface HostedPageAuthSnapshot {
  authenticated: boolean;
  authenticatedMember: HostedMember | null;
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

  const memberLookup = await lookupHostedMemberForPrivyIdentity({
    identity: session.identity,
    prisma: getPrisma(),
  });
  const authenticatedMember = memberLookup?.core ?? null;

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
