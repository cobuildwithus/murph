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
        reloadCurrentHostedAuthDocument();
      } else {
        await replaceHostedAppSessionAfterAmbiguousFailure();
      }
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

/**
 * A transport failure does not prove whether a destructive request reached the
 * server. Retry the idempotent logout fence and release cleared tabs only when
 * its successful response proves replacement authority.
 */
export async function replaceHostedAppSessionAfterAmbiguousFailure(): Promise<void> {
  try {
    await requestHostedOnboardingJson<{ ok: true }>({
      method: "POST",
      onSuccessfulResponseHeaders: () => {
        publishBrowserVaultSessionInvalidation();
        reloadCurrentHostedAuthDocument();
      },
      url: "/api/hosted-onboarding/session/logout",
    });
  } catch {
    // Keep the data-free session-ending latch set until replacement authority
    // is confirmed. The caller's existing error UI remains the recovery path.
  }
}
