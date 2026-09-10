"use client";

import { useSignMessage } from "@privy-io/react-auth";
import { useEffect, useRef, useState } from "react";
import { startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";

import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import {
  isSensitiveActionSignature,
  type SensitiveActionAuthorization,
  type SensitiveActionChallengeResponse,
  type SensitiveActionKind,
} from "@/src/lib/sensitive-actions/shared";

import { usePasskeyWalletMfa } from "./use-passkey-wallet-mfa";
import type { HostedCredentialChange } from "@/src/lib/better-auth/credential-change";

const SIGN_MESSAGE_TIMEOUT_MS = 60_000;

export function useSensitiveActionAuthorization() {
  const { signMessage } = useSignMessage();
  const signMessageRef = useRef(signMessage);
  useEffect(() => {
    signMessageRef.current = signMessage;
  }, [signMessage]);
  const setup = usePasskeyWalletMfa();
  const [passkeyConfigured, setPasskeyConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    void requestHostedOnboardingJson<{ configured: boolean }>({
      url: "/api/settings/approval-passkeys",
    }).then((status) => {
      if (active) setPasskeyConfigured(status.configured);
    }).catch(() => {
      // This read is a UI hint only. Keep retry available if it fails; the
      // action endpoint must select the current verifier before any proof.
    });
    return () => { active = false; };
  }, []);

  async function signChallenge(
    challenge: SensitiveActionChallengeResponse,
    credentialChange?: HostedCredentialChange,
  ): Promise<SensitiveActionAuthorization> {
    const method = await requestHostedOnboardingJson<
      { method: "wallet" } | { method: "passkey"; options: PublicKeyCredentialRequestOptionsJSON }
    >({ method: "POST", payload: { token: challenge.token, ...(credentialChange ? { credentialChange } : {}) }, url: "/api/settings/approval-passkeys/authenticate" });
    if (method.method === "passkey") {
      setPasskeyConfigured(true);
      const assertion = await startAuthentication({ optionsJSON: method.options });
      return { method: "passkey", assertion, token: challenge.token };
    }
    setPasskeyConfigured(false);
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
    setup: {
      ...setup,
      clientAuthenticated: passkeyConfigured !== false || setup.clientAuthenticated,
      ready: passkeyConfigured !== false || setup.ready,
    },
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
