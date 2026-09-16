"use client";

import { useEffect, useRef } from "react";
import { startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";

import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import {
  type SensitiveActionAuthorization,
  type SensitiveActionChallengeResponse,
  type SensitiveActionKind,
} from "@/src/lib/sensitive-actions/shared";

import { useLegacyApprovalRepair } from "./use-legacy-approval-repair";
import { useLegacyWalletApproval } from "./legacy-wallet-approval-context";
import type { HostedCredentialChange } from "@/src/lib/better-auth/credential-change";

export function useSensitiveActionAuthorization() {
  const repair = useLegacyApprovalRepair();
  const legacy = useLegacyWalletApproval();
  const { setup } = legacy;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function assertActive() {
    if (!mounted.current) throw new DOMException("Approval canceled.", "AbortError");
  }

  async function signChallenge(
    challenge: SensitiveActionChallengeResponse,
    credentialChange?: HostedCredentialChange,
    refreshChallenge?: () => Promise<SensitiveActionChallengeResponse>,
  ): Promise<SensitiveActionAuthorization> {
    const selectMethod = (current: SensitiveActionChallengeResponse) => requestHostedOnboardingJson<
      { method: "legacy-repair" } | { method: "wallet"; privyUserId: string } | { method: "passkey"; options: PublicKeyCredentialRequestOptionsJSON }
    >({ method: "POST", payload: { token: current.token, ...(credentialChange ? { credentialChange } : {}) }, url: "/api/settings/approval-passkeys/authenticate" });
    let method = await selectMethod(challenge);
    assertActive();
    if (method.method === "legacy-repair") {
      // Never repair after a failed native assertion. Registration does not sign
      // the old challenge (reauthentication may also have replaced the session).
      await repair.repair();
      assertActive();
      if (!refreshChallenge) throw new Error("Your Murph passkey is saved. Retry this request to confirm it.");
      challenge = await refreshChallenge();
      method = await selectMethod(challenge);
      if (method.method !== "passkey") throw new Error("Passkey setup changed. Try this request again.");
    }
    assertActive();
    if (method.method === "passkey") {
      const assertion = await startAuthentication({ optionsJSON: method.options });
      assertActive();
      return { method: "passkey", assertion, token: challenge.token };
    }
    if (method.method !== "wallet" || !method.privyUserId) throw new Error("Secure approval could not be selected. Try again.");
    return legacy.signChallenge(challenge, method.privyUserId);
  }

  async function authorize(kind: SensitiveActionKind): Promise<SensitiveActionAuthorization> {
    const getChallenge = () => requestHostedOnboardingJson<SensitiveActionChallengeResponse>({
      method: "POST",
      payload: { kind },
      url: "/api/settings/sensitive-action-challenge",
    });
    return signChallenge(await getChallenge(), undefined, getChallenge);
  }

  return {
    authorize,
    signChallenge,
    setup: {
      ...setup,
      pendingLabel: repair.pendingLabel ?? setup.pendingLabel,
      // The action endpoint owns current app identity and factor selection.
      // SDK restoration is an approval step, never a primary-login gate.
      clientAuthenticated: true,
      ready: true,
    },
  };
}
