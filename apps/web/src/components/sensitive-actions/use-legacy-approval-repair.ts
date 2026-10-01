"use client";

import { useEffect, useRef, useState } from "react";
import { startRegistration, type PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { HostedOnboardingApiError, requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";

// Shared by the existing Approve and passkey-setup controls. This only enrolls;
// the caller must obtain a separate native assertion to authorize any action.
export function useLegacyApprovalRepair() {
  const { reauthenticate } = useAuth();
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; active.current?.abort(); };
  }, []);

  async function repair() {
    if (!mounted.current) throw new DOMException("Passkey setup canceled.", "AbortError");
    if (active.current) throw new Error("Passkey setup is already in progress.");
    const controller = new AbortController();
    active.current = controller;
    const { signal } = controller;
    const getOptions = () => requestHostedOnboardingJson<{ options: PublicKeyCredentialCreationOptionsJSON; token: string }>({
      url: "/api/settings/approval-passkeys/legacy-options", method: "POST", payload: {}, signal,
    });
    try {
      setPendingLabel("Preparing your Murph passkey…");
      let registration;
      try { registration = await getOptions(); }
      catch (error) {
        if (!(error instanceof HostedOnboardingApiError) || error.code !== "SENSITIVE_ACTION_FRESH_LOGIN_REQUIRED") throw error;
        setPendingLabel("Sign in again to add your passkey…");
        if (!reauthenticate) throw new Error("Sign-in could not open. Refresh this page and try again.");
        await reauthenticate();
        signal.throwIfAborted();
        registration = await getOptions();
      }
      signal.throwIfAborted();
      setPendingLabel("Add your Murph passkey, then confirm the request…");
      const response = await startRegistration({ optionsJSON: registration.options });
      signal.throwIfAborted();
      await requestHostedOnboardingJson({ url: "/api/settings/approval-passkeys/register", method: "POST",
        payload: { legacyRepairToken: registration.token, response }, signal });
      signal.throwIfAborted();
    } finally {
      active.current = null;
      if (!signal.aborted) setPendingLabel(null);
    }
  }
  return { repair, pendingLabel };
}
