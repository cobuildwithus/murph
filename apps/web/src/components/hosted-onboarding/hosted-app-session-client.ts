"use client";

import {
  BROWSER_VAULT_SESSION_ENDING_LEASE_MS,
  publishBrowserVaultSessionEnding,
  publishBrowserVaultSessionInvalidation,
} from "@/src/lib/browser-vault/session-invalidation";

import { requestHostedOnboardingJson } from "./client-api";
import { reloadCurrentHostedAuthDocument } from "./hosted-auth-navigation";

/** A 2xx verification response may already have replaced the browser cookie. */
export async function verifyHostedAppSession(input: {
  url: "/api/auth/otp/verify" | "/api/auth/telegram/verify";
  payload: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<void> {
  const result = await requestHostedOnboardingJson<{ ok?: unknown; memberId?: unknown }>({
    ...input,
    onSuccessfulResponseHeaders: publishBrowserVaultSessionInvalidation,
    onSuccessfulResponseError: reloadCurrentHostedAuthDocument,
  });
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
    await requestHostedOnboardingJson<{ ok: true }>({
      method: "POST",
      onSuccessfulResponseError: reloadCurrentHostedAuthDocument,
      onSuccessfulResponseHeaders: () => {
        receivedReplacementHeaders = true;
        publishBrowserVaultSessionInvalidation();
      },
      signal: AbortSignal.timeout(BROWSER_VAULT_SESSION_ENDING_LEASE_MS),
      url: input.url,
    });
  } catch (error) {
    if (!receivedReplacementHeaders) {
      publishBrowserVaultSessionInvalidation();
      reloadCurrentHostedAuthDocument();
    }
    throw error;
  }

}
