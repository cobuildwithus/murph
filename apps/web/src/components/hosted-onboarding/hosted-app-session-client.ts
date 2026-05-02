"use client";

import { requestHostedOnboardingJson } from "./client-api";

export async function logoutHostedAppSession(input: {
  logoutPrivy?: () => Promise<void> | void;
} = {}): Promise<void> {
  await requestHostedOnboardingJson<{ ok: true }>({
    method: "POST",
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
