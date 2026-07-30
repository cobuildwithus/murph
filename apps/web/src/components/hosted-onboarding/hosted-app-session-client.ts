"use client";

import {
  BROWSER_VAULT_SESSION_ENDING_LEASE_MS,
  publishBrowserVaultSessionEnding,
  publishBrowserVaultSessionInvalidation,
} from "@/src/lib/browser-vault/session-invalidation";

import { requestHostedOnboardingJson } from "./client-api";
import { reloadCurrentHostedAuthDocument } from "./hosted-auth-navigation";

export async function logoutHostedAppSession(input: {
  logoutPrivy?: () => Promise<void> | void;
} = {}): Promise<void> {
  return endHostedAppSession({
    ...input,
    url: "/api/hosted-onboarding/session/logout",
  });
}

export async function declineHostedLaunchConsent(input: {
  logoutPrivy?: () => Promise<void> | void;
} = {}): Promise<void> {
  return endHostedAppSession({
    ...input,
    url: "/api/legal/consent/decline",
  });
}

async function endHostedAppSession(input: {
  logoutPrivy?: () => Promise<void> | void;
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

  if (!input.logoutPrivy) {
    return;
  }

  try {
    await input.logoutPrivy();
  } catch {
    // Server-side Murph app-session logout is authoritative. Privy logout is
    // best-effort cleanup for client SDK state after the app session is gone.
  }
}
