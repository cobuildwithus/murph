import "server-only";

import { cache } from "react";

import { getPrisma } from "../prisma";
import { isHostedOnboardingError } from "./errors";
import { getHostedPrivySession, type HostedPrivySession } from "./hosted-session";
import { type HostedMemberCoreState } from "./hosted-member-store";
import { type PrivyLinkedAccountLike } from "./privy-shared";
import { type HostedMemberPrivyIdentityLookup } from "./member-identity-service";
import { resolvePrivyMemberAuthFromSession } from "./request-auth";
import {
  anonymousHostedSidebarAuthSnapshot,
  type HostedSidebarAuthSnapshot,
} from "./sidebar-auth";

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

const resolveHostedSidebarAuthSnapshot = cache(async (): Promise<HostedSidebarAuthSnapshot> => {
  let session: HostedPrivySession | null;

  try {
    session = await getHostedPrivySession();
  } catch (error) {
    if (isHostedSidebarAuthSessionError(error)) {
      return anonymousHostedSidebarAuthSnapshot;
    }

    throw error;
  }

  if (!session) {
    return anonymousHostedSidebarAuthSnapshot;
  }

  return {
    authenticated: true,
    label: resolveHostedSidebarAuthLabel(session),
  };
});

export async function getHostedSidebarAuthSnapshot(): Promise<HostedSidebarAuthSnapshot> {
  return resolveHostedSidebarAuthSnapshot();
}

function isHostedPageAuthSessionError(error: unknown): boolean {
  return isHostedOnboardingError(error) && error.code === "PRIVY_AUTH_FAILED";
}

function isHostedSidebarAuthSessionError(error: unknown): boolean {
  return isHostedOnboardingError(error)
    && error.code !== "PRIVY_CONFIG_REQUIRED"
    && error.code.startsWith("PRIVY_");
}

function resolveHostedSidebarAuthLabel(session: HostedPrivySession): string | null {
  return session.identity.email?.address ?? session.identity.phone?.number ?? null;
}
