"use client";

import { createContext, useContext } from "react";
import type { SensitiveActionAuthorization, SensitiveActionChallengeResponse } from "@/src/lib/sensitive-actions/shared";
import type { usePasskeyWalletMfa } from "./use-passkey-wallet-mfa";

// Temporary compatibility port. First-party approval never imports or mounts
// SDK hooks; the existing Privy provider supplies this only for legacy factors.
export interface LegacyWalletApproval {
  setup: ReturnType<typeof usePasskeyWalletMfa>;
  signChallenge(challenge: SensitiveActionChallengeResponse, expectedUserId: string): Promise<SensitiveActionAuthorization>;
}

async function unavailable(): Promise<never> {
  throw new Error("Your previous secure approval is unavailable. Contact support to recover it.");
}

export const LegacyWalletApprovalContext = createContext<LegacyWalletApproval>({
  setup: {
    clientAuthenticated: false, configured: false, ready: true, pendingLabel: null,
    walletAddress: null, error: null, ensureConfigured: unavailable, ensureExistingFactor: unavailable,
    loginForSetup: unavailable,
  },
  signChallenge: unavailable,
});

export function useLegacyWalletApproval(): LegacyWalletApproval {
  return useContext(LegacyWalletApprovalContext);
}
