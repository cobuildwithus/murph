import "server-only";

import { type HostedMember } from "@prisma/client";
import { cache } from "react";

import { getPrisma } from "../prisma";
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

const resolveHostedPageAuthSnapshot = cache(async (): Promise<HostedPageAuthSnapshot> => {
  const session = await getHostedPrivySession();

  if (!session) {
    return {
      authenticated: false,
      authenticatedMember: null,
      linkedAccounts: [],
      memberLookup: null,
      session: null,
    };
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
