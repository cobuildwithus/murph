"use client";

import { startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";

import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import {
  type SensitiveActionAuthorization,
  type SensitiveActionChallengeResponse,
  type SensitiveActionKind,
} from "@/src/lib/sensitive-actions/shared";

import type { HostedCredentialChange } from "@/src/lib/better-auth/credential-change";

export function useSensitiveActionAuthorization() {

  async function signChallenge(
    challenge: SensitiveActionChallengeResponse,
    credentialChange?: HostedCredentialChange,
  ): Promise<SensitiveActionAuthorization> {
    const method = await requestHostedOnboardingJson<
      { method: "passkey"; options: PublicKeyCredentialRequestOptionsJSON }
    >({ method: "POST", payload: { token: challenge.token, ...(credentialChange ? { credentialChange } : {}) }, url: "/api/settings/approval-passkeys/authenticate" });
    if (method.method !== "passkey") throw new Error("Secure approval could not be selected. Try again.");
    const assertion = await startAuthentication({ optionsJSON: method.options });
    return { method: "passkey", assertion, token: challenge.token };
  }

  async function authorize(kind: SensitiveActionKind): Promise<SensitiveActionAuthorization> {
    const challenge = await requestHostedOnboardingJson<SensitiveActionChallengeResponse>({
      method: "POST",
      payload: { kind },
      url: "/api/settings/sensitive-action-challenge",
    });
    return signChallenge(challenge);
  }

  return { authorize, signChallenge };
}
