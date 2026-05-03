import "server-only";

import { cache } from "react";

import { getHostedAppSession, type HostedAppSession } from "./app-session";
import { type HostedMemberCoreState } from "./hosted-member-store";
import {
  anonymousHostedSidebarAuthSnapshot,
  type HostedSidebarAuthSnapshot,
} from "./sidebar-auth";

export interface HostedPageAuthSnapshot {
  authenticated: boolean;
  authenticatedMember: HostedMemberCoreState | null;
  session: HostedAppSession | null;
}

function buildAnonymousHostedPageAuthSnapshot(): HostedPageAuthSnapshot {
  return {
    authenticated: false,
    authenticatedMember: null,
    session: null,
  };
}

const resolveHostedPageAuthSnapshot = cache(async (): Promise<HostedPageAuthSnapshot> => {
  const session = await getHostedAppSession();

  if (!session) {
    return buildAnonymousHostedPageAuthSnapshot();
  }

  return {
    authenticated: true,
    authenticatedMember: session.member,
    session,
  };
});

export async function getHostedPageAuthSnapshot(): Promise<HostedPageAuthSnapshot> {
  return resolveHostedPageAuthSnapshot();
}

const resolveHostedSidebarAuthSnapshot = cache(async (): Promise<HostedSidebarAuthSnapshot> => {
  const session = await getHostedAppSession();

  if (!session) {
    return anonymousHostedSidebarAuthSnapshot;
  }

  return {
    authenticated: true,
    label: null,
  };
});

export async function getHostedSidebarAuthSnapshot(): Promise<HostedSidebarAuthSnapshot> {
  return resolveHostedSidebarAuthSnapshot();
}
