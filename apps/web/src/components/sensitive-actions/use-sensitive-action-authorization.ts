"use client";

import { useSignMessage } from "@privy-io/react-auth";
import { useEffect, useRef } from "react";

import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import {
  isSensitiveActionSignature,
  type SensitiveActionAuthorization,
  type SensitiveActionChallengeResponse,
  type SensitiveActionKind,
} from "@/src/lib/sensitive-actions/shared";

import { usePasskeyWalletMfa } from "./use-passkey-wallet-mfa";

const SIGN_MESSAGE_TIMEOUT_MS = 60_000;

export function useSensitiveActionAuthorization() {
  const { signMessage } = useSignMessage();
  const signMessageRef = useRef(signMessage);
  useEffect(() => {
    signMessageRef.current = signMessage;
  }, [signMessage]);
  const setup = usePasskeyWalletMfa();

  async function signChallenge(
    challenge: SensitiveActionChallengeResponse,
  ): Promise<SensitiveActionAuthorization> {
    const wallet = await setup.ensureConfigured();
    const { signature } = await withTimeout(
      signMessageRef.current(
        { message: challenge.message },
        { address: wallet.address },
      ),
      SIGN_MESSAGE_TIMEOUT_MS,
      "Secure approval timed out. Try again.",
    );

    if (!isSensitiveActionSignature(signature)) {
      throw new Error("Your secure approval could not be completed. Try again.");
    }

    return {
      signature,
      token: challenge.token,
    };
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
    setup,
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}
