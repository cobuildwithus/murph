import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { hostedOnboardingError } from "./errors";
import {
  readHostedPrivyIdentityTokenFromCookieStore,
  readHostedPrivyIdentityTokenFromRequestCookies,
  resolveHostedPrivyIdentityFromVerifiedUser,
  type HostedPrivyIdentity,
  type HostedPrivyUser,
  verifyHostedPrivyIdentityToken,
} from "./privy";
import { type PrivyLinkedAccountLike, resolveHostedPrivyLinkedAccounts } from "./privy-shared";

export interface HostedPrivySession {
  identity: HostedPrivyIdentity;
  linkedAccounts: PrivyLinkedAccountLike[];
  verifiedPrivyUser: HostedPrivyUser;
}

const resolveHostedPrivySessionFromCookies = cache(async (): Promise<HostedPrivySession | null> => {
  const cookieStore = await cookies();
  const identityToken = readHostedPrivyIdentityTokenFromCookieStore(cookieStore);

  if (!identityToken) {
    return null;
  }

  return buildHostedPrivySession(identityToken);
});

export async function getHostedPrivySession(): Promise<HostedPrivySession | null> {
  return resolveHostedPrivySessionFromCookies();
}

export async function requireHostedPrivySession(): Promise<HostedPrivySession> {
  const session = await getHostedPrivySession();

  if (!session) {
    throw hostedOnboardingError({
      code: "AUTH_REQUIRED",
      message: "Verify your phone to continue.",
      httpStatus: 401,
    });
  }

  return session;
}

export async function resolveHostedPrivySessionFromRequest(
  request: Request,
): Promise<HostedPrivySession | null> {
  const identityToken = readHostedPrivyIdentityTokenFromRequestCookies(request);

  if (!identityToken) {
    return null;
  }

  return buildHostedPrivySession(identityToken);
}

async function buildHostedPrivySession(identityToken: string): Promise<HostedPrivySession> {
  const verifiedPrivyUser = await verifyHostedPrivyIdentityToken(identityToken);

  return {
    identity: resolveHostedPrivyIdentityFromVerifiedUser(verifiedPrivyUser),
    linkedAccounts: resolveHostedPrivyLinkedAccounts(verifiedPrivyUser),
    verifiedPrivyUser,
  };
}
