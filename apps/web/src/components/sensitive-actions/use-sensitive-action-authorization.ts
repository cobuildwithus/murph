"use client";

import { startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";

import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import {
  type SensitiveActionAuthorization,
  type SensitiveActionChallengeResponse,
  type SensitiveActionKind,
} from "@/src/lib/sensitive-actions/shared";

import { useLegacyWalletApproval } from "./legacy-wallet-approval-context";
import type { HostedCredentialChange } from "@/src/lib/better-auth/credential-change";

export function useSensitiveActionAuthorization() {
  const legacy = useLegacyWalletApproval();
  const { setup } = legacy;

  async function signChallenge(
    challenge: SensitiveActionChallengeResponse,
    credentialChange?: HostedCredentialChange,
  ): Promise<SensitiveActionAuthorization> {
    const method = await requestHostedOnboardingJson<
      { method: "wallet"; privyUserId: string } | { method: "passkey"; options: PublicKeyCredentialRequestOptionsJSON }
    >({ method: "POST", payload: { token: challenge.token, ...(credentialChange ? { credentialChange } : {}) }, url: "/api/settings/approval-passkeys/authenticate" });
    if (method.method === "passkey") {
      const assertion = await startAuthentication({ optionsJSON: method.options });
      return { method: "passkey", assertion, token: challenge.token };
    }
    if (method.method !== "wallet" || !method.privyUserId) throw new Error("Secure approval could not be selected. Try again.");
    return legacy.signChallenge(challenge, method.privyUserId);
  }

  async function authorize(kind: SensitiveActionKind): Promise<SensitiveActionAuthorization> {
    const challenge = await requestHostedOnboardingJson<SensitiveActionChallengeResponse>({
      method: "POST",
      payload: { kind },
      url: "/api/settings/sensitive-action-challenge",
    });
    return signChallenge(challenge);
  }

  return {
    authorize,
    signChallenge,
    setup: {
      ...setup,
      // The action endpoint owns current app identity and factor selection.
      // SDK restoration is an approval step, never a primary-login gate.
      clientAuthenticated: true,
      ready: true,
    },
  };
}
