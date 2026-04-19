import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { hostedOnboardingError } from "./errors";
import {
  verifyHostedPrivyIdentityToken,
} from "./privy";
import {
  readHostedPrivyIdentityTokenFromCookieStore,
  readHostedPrivyIdentityTokenFromRequestCookies,
} from "./privy-token";
import {
  buildHostedPrivySessionState,
  type HostedPrivySessionState,
} from "./privy-user";

export type HostedPrivySession = HostedPrivySessionState;

const resolveHostedPrivySessionFromCookies = cache(async (): Promise<HostedPrivySession | null> => {
  const cookieStore = await cookies();
  const identityToken = readHostedPrivyIdentityTokenFromCookieStore(cookieStore);

  if (!identityToken) {
    return null;
  }

  return resolveHostedPrivySessionFromIdentityToken(identityToken);
});

export async function getHostedPrivySession(): Promise<HostedPrivySession | null> {
  return resolveHostedPrivySessionFromCookies();
}

export async function requireHostedPrivySession(): Promise<HostedPrivySession> {
  const session = await getHostedPrivySession();

  if (!session) {
    throw hostedOnboardingError({
      code: "AUTH_REQUIRED",
      message: "Sign in to continue.",
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

  return resolveHostedPrivySessionFromIdentityToken(identityToken);
}

async function resolveHostedPrivySessionFromIdentityToken(identityToken: string): Promise<HostedPrivySession> {
  return buildHostedPrivySessionState(await verifyHostedPrivyIdentityToken(identityToken));
}
