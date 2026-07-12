"use client";

import { clearBrowserVaultWarmState } from "@/src/lib/browser-vault/warm-store";
import { publishBrowserVaultSessionInvalidation } from "@/src/lib/browser-vault/session-invalidation";

import { requestHostedOnboardingJson } from "./client-api";

export async function logoutHostedAppSession(input: {
  logoutPrivy?: () => Promise<void> | void;
} = {}): Promise<void> {
  clearBrowserVaultWarmState();
  publishBrowserVaultSessionInvalidation();

  await requestHostedOnboardingJson<{ ok: true }>({
    method: "POST",
    onSuccessfulResponseHeaders: publishBrowserVaultSessionInvalidation,
    url: "/api/hosted-onboarding/session/logout",
  });

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
