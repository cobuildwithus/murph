"use client";

import {
  publishBrowserVaultSessionEnding,
  publishBrowserVaultSessionInvalidation,
} from "@/src/lib/browser-vault/session-invalidation";

import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "./client-api";
import { reloadCurrentHostedAuthDocument } from "./hosted-auth-navigation";

export async function logoutHostedAppSession(input: {
  logoutPrivy?: () => Promise<void> | void;
} = {}): Promise<void> {
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
      url: "/api/hosted-onboarding/session/logout",
    });
  } catch (error) {
    if (!receivedReplacementHeaders) {
      if (error instanceof HostedOnboardingApiError) {
        publishBrowserVaultSessionInvalidation();
      }
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
