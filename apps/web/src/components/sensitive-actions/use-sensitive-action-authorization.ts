"use client";

import { useSignMessage } from "@privy-io/react-auth";

import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import {
  isSensitiveActionSignature,
  type SensitiveActionAuthorization,
  type SensitiveActionChallengeResponse,
  type SensitiveActionKind,
} from "@/src/lib/sensitive-actions/shared";

import { usePasskeyWalletMfa } from "./use-passkey-wallet-mfa";

export function useSensitiveActionAuthorization() {
  const { signMessage } = useSignMessage();
  const setup = usePasskeyWalletMfa();

  async function authorize(kind: SensitiveActionKind): Promise<SensitiveActionAuthorization> {
    const wallet = await setup.ensureConfigured();
    const challenge = await requestHostedOnboardingJson<SensitiveActionChallengeResponse>({
      method: "POST",
      payload: { kind },
      url: "/api/settings/sensitive-action-challenge",
    });
    const { signature } = await signMessage(
      { message: challenge.message },
      { address: wallet.address },
    );

    if (!isSensitiveActionSignature(signature)) {
      throw new Error("Privy returned an invalid wallet signature.");
    }

    return {
      signature,
      token: challenge.token,
    };
  }

  return {
    authorize,
    setup,
  };
}
