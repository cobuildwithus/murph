"use client";

import { useEffect, useRef } from "react";
import { startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";

import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import {
  type SensitiveActionAuthorization,
  type SensitiveActionChallengeResponse,
  type SensitiveActionKind,
} from "@/src/lib/sensitive-actions/shared";

import { useInitialApprovalEnrollment } from "./use-initial-approval-enrollment";
import type { HostedCredentialChange } from "@/src/lib/better-auth/credential-change";

export function useSensitiveActionAuthorization() {
  const repair = useInitialApprovalEnrollment();
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
      { method: "initial" } | { method: "passkey"; options: PublicKeyCredentialRequestOptionsJSON }
    >({ method: "POST", payload: { token: current.token, ...(credentialChange ? { credentialChange } : {}) }, url: "/api/settings/approval-passkeys/authenticate" });
    let method = await selectMethod(challenge);
    assertActive();
    if (method.method === "initial") {
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
    throw new Error("Secure approval could not be selected. Try again.");
  }

  async function authorize(kind: SensitiveActionKind): Promise<SensitiveActionAuthorization> {
    const getChallenge = () => requestHostedOnboardingJson<SensitiveActionChallengeResponse>({
      method: "POST",
      payload: { kind },
      url: "/api/settings/sensitive-action-challenge",
    });
    return signChallenge(await getChallenge(), undefined, getChallenge);
  }

  return { authorize, signChallenge };
}
