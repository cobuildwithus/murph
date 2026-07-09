"use client";

import {
  type User,
  useCreateWallet,
  useLinkWithPasskey,
  useMfaEnrollment,
  usePrivy,
} from "@privy-io/react-auth";
import { useEffect, useRef, useState } from "react";

import {
  findHostedPrivyPasskeyCredentialIds,
  hasOnlyHostedPrivyPasskeyMfa,
  readHostedPrivyMfaMethodTypes,
  selectHostedPrivyEmbeddedEthereumWallet,
  type HostedPrivyEmbeddedEthereumWallet,
} from "@/src/lib/hosted-onboarding/privy-wallet-mfa";

type SetupStep = "load-client" | "create-passkey" | "create-wallet" | "enroll-mfa";

export function usePasskeyWalletMfa() {
  const { user, ready } = usePrivy();
  const { linkWithPasskey } = useLinkWithPasskey();
  const { createWallet } = useCreateWallet();
  const { initEnrollmentWithPasskey, submitEnrollmentWithPasskey } = useMfaEnrollment();
  const userRef = useRef<User | null>(user);
  const readyRef = useRef(ready);
  useEffect(() => {
    userRef.current = user;
  }, [user]);
  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);

  const [activeStep, setActiveStep] = useState<SetupStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const walletSelection = selectHostedPrivyEmbeddedEthereumWallet(user);
  const configured = walletSelection.status === "ready" && hasOnlyHostedPrivyPasskeyMfa(user);

  async function ensureConfigured(): Promise<HostedPrivyEmbeddedEthereumWallet> {
    setError(null);
    try {
      if (!readyRef.current || !userRef.current) {
        setActiveStep("load-client");
        await waitForClientReady({ readyRef, userRef });
      }

      if (findHostedPrivyPasskeyCredentialIds(userRef.current).length === 0) {
        setActiveStep("create-passkey");
        await linkWithPasskey();
        await waitForUserState(
          userRef,
          (current) => findHostedPrivyPasskeyCredentialIds(current).length > 0,
          stepLabel("create-passkey"),
        );
      }

      let currentWallet = selectHostedPrivyEmbeddedEthereumWallet(userRef.current);
      if (currentWallet.status === "ambiguous") {
        throw new Error("Something looks off with your secure setup. Contact support before continuing.");
      }
      if (currentWallet.status === "missing") {
        setActiveStep("create-wallet");
        await createWallet();
        await waitForUserState(
          userRef,
          (current) => selectHostedPrivyEmbeddedEthereumWallet(current).status === "ready",
          stepLabel("create-wallet"),
        );
        currentWallet = selectHostedPrivyEmbeddedEthereumWallet(userRef.current);
      }
      if (currentWallet.status !== "ready") {
        throw new Error("Your secure setup isn't ready yet. Try again.");
      }

      const mfaMethods = readHostedPrivyMfaMethodTypes(userRef.current);
      if (mfaMethods.length > 0 && !hasOnlyHostedPrivyPasskeyMfa(userRef.current)) {
        throw new Error("Your passkey must be the only method protecting secure approvals. Contact support to fix this.");
      }
      if (!hasOnlyHostedPrivyPasskeyMfa(userRef.current)) {
        setActiveStep("enroll-mfa");
        const credentialIds = findHostedPrivyPasskeyCredentialIds(userRef.current);
        if (credentialIds.length === 0) {
          throw new Error("We couldn't find your new passkey. Try again.");
        }
        await initEnrollmentWithPasskey();
        await submitEnrollmentWithPasskey(
          { credentialIds },
          { removeForLogin: false },
        );
        await waitForUserState(
          userRef,
          hasOnlyHostedPrivyPasskeyMfa,
          stepLabel("enroll-mfa"),
        );
      }

      return currentWallet.wallet;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Secure approval setup failed. Try again.";
      setError(message);
      throw caught;
    } finally {
      setActiveStep(null);
    }
  }

  return {
    clientAuthenticated: user !== null,
    configured,
    ensureConfigured,
    error,
    pendingLabel: activeStep ? `${stepLabel(activeStep)}…` : null,
    ready,
    walletAddress: walletSelection.status === "ready" ? walletSelection.wallet.address : null,
  };
}

function stepLabel(step: SetupStep): string {
  switch (step) {
    case "load-client":
      return "Loading secure approval";
    case "create-passkey":
      return "Creating passkey";
    case "create-wallet":
      return "Setting up secure approvals";
    case "enroll-mfa":
      return "Linking your passkey";
  }
}

async function waitForClientReady(
  state: {
    readyRef: { current: boolean };
    userRef: { current: User | null };
  },
  timeoutMs = 10_000,
  intervalMs = 50,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (state.readyRef.current && state.userRef.current) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Secure approval is still loading. Try again in a moment.");
}

async function waitForUserState(
  userRef: { current: User | null },
  predicate: (user: User) => boolean,
  label: string,
  timeoutMs = 5_000,
  intervalMs = 50,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = userRef.current;
    if (current && predicate(current)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${label} took too long. Please try again.`);
}
