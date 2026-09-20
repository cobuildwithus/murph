"use client";

import {
  BROWSER_VAULT_SESSION_ENDING_LEASE_MS,
  publishBrowserVaultSessionEnding,
  publishBrowserVaultSessionInvalidation,
} from "@/src/lib/browser-vault/session-invalidation";

import { requestHostedOnboardingJson } from "./client-api";
import { reloadCurrentHostedAuthDocument } from "./hosted-auth-navigation";

// Cookie responses share authority across tabs. Wait for older writers before
// dispatching a replacement; discarding a late JS result cannot undo Set-Cookie.
export async function withHostedSessionCookieWrite<T>(write: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return navigator.locks
    ? navigator.locks.request("murph-auth-session-cookie", { signal }, write)
    : write();
}

/** A 2xx verification response may already have replaced the browser cookie. */
export async function verifyHostedAppSession(input: {
  url: "/api/auth/otp/verify" | "/api/auth/telegram/verify";
  payload: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<void> {
  const signal = AbortSignal.any([AbortSignal.timeout(30_000), ...(input.signal ? [input.signal] : [])]);
  const result = await withHostedSessionCookieWrite(() => requestHostedOnboardingJson<{ ok?: unknown; memberId?: unknown }>({
    ...input,
    signal,
    onSuccessfulResponseHeaders: publishBrowserVaultSessionInvalidation,
    onSuccessfulResponseError: reloadCurrentHostedAuthDocument,
  }), signal);
  if (result.ok !== true || typeof result.memberId !== "string" || !result.memberId) {
    reloadCurrentHostedAuthDocument();
    throw new Error("Sign-in could not be confirmed. Reload to check your session.");
  }
}

export async function logoutHostedAppSession(): Promise<void> {
  return endHostedAppSession({
    url: "/api/hosted-onboarding/session/logout",
  });
}

export async function declineHostedLaunchConsent(): Promise<void> {
  return endHostedAppSession({
    url: "/api/legal/consent/decline",
  });
}

async function endHostedAppSession(input: {
  url: string;
}): Promise<void> {
  publishBrowserVaultSessionEnding();
  let receivedReplacementHeaders = false;

  try {
    const signal = AbortSignal.timeout(BROWSER_VAULT_SESSION_ENDING_LEASE_MS);
    await withHostedSessionCookieWrite(() => requestHostedOnboardingJson<{ ok: true }>({
      method: "POST",
      onSuccessfulResponseError: reloadCurrentHostedAuthDocument,
      onSuccessfulResponseHeaders: () => {
        receivedReplacementHeaders = true;
        publishBrowserVaultSessionInvalidation();
      },
      signal,
      url: input.url,
    }), signal);
  } catch (error) {
    if (!receivedReplacementHeaders) {
      publishBrowserVaultSessionInvalidation();
      reloadCurrentHostedAuthDocument();
    }
    throw error;
  }

}
