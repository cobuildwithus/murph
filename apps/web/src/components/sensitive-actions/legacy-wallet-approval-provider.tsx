"use client";

import { useSignMessage } from "@privy-io/react-auth";
import { useEffect, useRef, type ReactNode } from "react";
import { isSensitiveActionSignature, type SensitiveActionChallengeResponse } from "@/src/lib/sensitive-actions/shared";
import { usePasskeyWalletMfa } from "./use-passkey-wallet-mfa";
import { LegacyWalletApprovalContext } from "./legacy-wallet-approval-context";

export function LegacyWalletApprovalProvider({ children }: { children: ReactNode }) {
  const { signMessage } = useSignMessage();
  const signer = useRef(signMessage);
  useEffect(() => { signer.current = signMessage; }, [signMessage]);
  const setup = usePasskeyWalletMfa();

  async function signChallenge(challenge: SensitiveActionChallengeResponse, expectedUserId: string) {
    const wallet = await setup.ensureExistingFactor(expectedUserId);
    const { signature } = await withTimeout(signer.current(
      { message: challenge.message }, { address: wallet.address },
    ));
    if (!isSensitiveActionSignature(signature)) throw new Error("Your secure approval could not be completed. Try again.");
    return { signature, token: challenge.token };
  }

  return <LegacyWalletApprovalContext.Provider value={{ setup, signChallenge }}>{children}</LegacyWalletApprovalContext.Provider>;
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("Secure approval timed out. Try again.")), 60_000);
    })]);
  } finally { clearTimeout(timeout); }
}
