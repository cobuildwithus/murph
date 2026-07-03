import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import type { HostedAppSession } from "./app-session";
import { type HostedMemberCoreState } from "./hosted-member-store";
import {
  anonymousHostedSidebarAuthSnapshot,
  type HostedSidebarAuthSnapshot,
} from "./sidebar-auth";
import { readActiveHostedMemberAccess } from "./member-access";
import { deriveHostedPostVerificationStage } from "./lifecycle";

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
  const session = await getHostedAppSessionForPublicPageAuth();

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

export async function getHostedDashboardPageAuthSnapshot(): Promise<HostedPageAuthSnapshot> {
  const auth = await getHostedPageAuthSnapshot();
  await redirectHostedDashboardCheckoutIfNeeded(auth);
  return auth;
}

export async function redirectHostedDashboardCheckoutIfNeeded(
  auth: HostedPageAuthSnapshot,
): Promise<void> {
  const member = auth.authenticatedMember;
  if (!member) {
    return;
  }

  const stageWithoutSponsoredAccess = deriveHostedPostVerificationStage({
    billingStatus: member.billingStatus,
    suspendedAt: member.suspendedAt,
  });
  if (stageWithoutSponsoredAccess !== "checkout") {
    return;
  }

  if (await readActiveHostedMemberAccess({ memberId: member.id })) {
    return;
  }

  redirect("/join");
}

const resolveHostedSidebarAuthSnapshot = cache(async (): Promise<HostedSidebarAuthSnapshot> => {
  const session = await getHostedAppSessionForPublicPageAuth();

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

async function getHostedAppSessionForPublicPageAuth(): Promise<HostedAppSession | null> {
  try {
    const { getHostedAppSession } = await import("./app-session");
    return await getHostedAppSession();
  } catch (error) {
    if (isHostedSessionStoreUnavailableError(error)) {
      return null;
    }

    throw error;
  }
}

function isHostedSessionStoreUnavailableError(error: unknown): boolean {
  const code = getErrorStringField(error, "code");

  if (code && HOSTED_SESSION_STORE_UNAVAILABLE_PRISMA_CODES.has(code)) {
    return true;
  }

  const name = getErrorStringField(error, "name");
  if (name === "PrismaClientInitializationError") {
    return true;
  }

  const message = error instanceof Error ? error.message : null;
  return Boolean(
    message
      && HOSTED_SESSION_STORE_UNAVAILABLE_MESSAGE_PATTERNS.some((pattern) => pattern.test(message)),
  );
}

const HOSTED_SESSION_STORE_UNAVAILABLE_PRISMA_CODES = new Set([
  "P1000",
  "P1001",
  "P1002",
  "P1003",
  "P1008",
  "P1009",
  "P1010",
  "P1011",
  "P1017",
  "P2021",
  "P2022",
]);

const HOSTED_SESSION_STORE_UNAVAILABLE_MESSAGE_PATTERNS = [
  /\bDATABASE_URL\b/u,
  /\bdatabase\b.*\bunavailable\b/iu,
  /\bconnection\b.*\b(?:closed|refused|terminated|timeout|timed out)\b/iu,
  /\btable\b.*\bdoes not exist\b/iu,
  /\bcolumn\b.*\bdoes not exist\b/iu,
];

function getErrorStringField(error: unknown, field: string): string | null {
  if (!error || typeof error !== "object" || !(field in error)) {
    return null;
  }

  const value = (error as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}
