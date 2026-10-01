"use client";

import {
  type ConnectedWallet,
  type User,
  useCreateWallet,
  useLinkWithPasskey,
  useLoginWithPasskey,
  useMfaEnrollment,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth";
import { useEffect, useRef, useState } from "react";
import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";

import {
  findHostedPrivyPasskeyCredentialIds,
  hasOnlyHostedPrivyPasskeyMfa,
  readHostedPrivyMfaMethodTypes,
  selectHostedPrivyEmbeddedEthereumWallet,
  type HostedPrivyEmbeddedEthereumWallet,
} from "@/src/lib/hosted-onboarding/privy-wallet-mfa";

type SetupStep = "load-client" | "create-passkey" | "create-wallet" | "enroll-mfa";

export function usePasskeyWalletMfa() {
  const { user, ready, logout, login } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { linkWithPasskey } = useLinkWithPasskey();
  const { createWallet } = useCreateWallet();
  const { initEnrollmentWithPasskey, submitEnrollmentWithPasskey } = useMfaEnrollment();
  const userRef = useRef<User | null>(user);
  const { loginWithPasskey } = useLoginWithPasskey({ onComplete: ({ user: authenticatedUser }) => { userRef.current = authenticatedUser; } });
  const readyRef = useRef(ready);
  const walletsRef = useRef<ConnectedWallet[]>(wallets);
  const walletsReadyRef = useRef(walletsReady);
  useEffect(() => {
    userRef.current = user;
    readyRef.current = ready;
    walletsRef.current = wallets;
    walletsReadyRef.current = walletsReady;
  }, [ready, user, wallets, walletsReady]);

  const [activeStep, setActiveStep] = useState<SetupStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const walletSelection = selectHostedPrivyEmbeddedEthereumWallet(user);
  const configured = walletSelection.status === "ready" && hasOnlyHostedPrivyPasskeyMfa(user);

  async function readSetupUser(): Promise<string> {
    const status = await requestHostedOnboardingJson<{ legacyUserId: string | null }>({ url: "/api/settings/approval-passkeys" });
    if (!status.legacyUserId) throw new Error("Use your current Murph passkey settings to continue.");
    return status.legacyUserId;
  }

  function assertSetupUser(expected: string) {
    if (userRef.current?.id !== expected) throw new Error("Use the same account as your Murph sign-in to set up secure approvals.");
  }

  async function loginForSetup() {
    setError(null); setActiveStep("load-client");
    try {
      const expected = await readSetupUser();
      await waitForClientReady({ readyRef, userRef, allowSignedOut: true });
      if (userRef.current && userRef.current.id !== expected) await logout();
      login({ loginMethods: ["email", "sms", "telegram", "passkey"] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your existing sign-in could not open.");
    } finally { setActiveStep(null); }
  }

  async function ensureExistingFactor(expectedUserId: string): Promise<HostedPrivyEmbeddedEthereumWallet> {
    setError(null);
    setActiveStep("load-client");
    try {
      await waitForClientReady({ readyRef, userRef, allowSignedOut: true });
      if (userRef.current?.id !== expectedUserId) {
        if (userRef.current) await logout();
        // Restore only the old factor. This does not call Murph login, sync
        // contacts, create a wallet, or change the current application session.
        await loginWithPasskey();
        await waitForUserState(userRef, (current) => current.id === expectedUserId, "Loading secure approval");
      }
      const selected = selectHostedPrivyEmbeddedEthereumWallet(userRef.current);
      if (userRef.current?.id !== expectedUserId || selected.status !== "ready" || !hasOnlyHostedPrivyPasskeyMfa(userRef.current)) {
        throw new Error("Your existing secure approval could not be verified. Contact support to recover it.");
      }
      await waitForConnectedWallet({ walletsReadyRef, walletsRef }, selected.wallet.address);
      const current = selectHostedPrivyEmbeddedEthereumWallet(userRef.current);
      if (userRef.current?.id !== expectedUserId || current.status !== "ready"
        || current.wallet.address !== selected.wallet.address || !hasOnlyHostedPrivyPasskeyMfa(userRef.current)) {
        throw new Error("Your secure approval account changed. Try again.");
      }
      return selected.wallet;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Secure approval could not be restored.");
      throw caught;
    } finally { setActiveStep(null); }
  }

  async function ensureConfigured(): Promise<HostedPrivyEmbeddedEthereumWallet> {
    setError(null);
    try {
      const expected = await readSetupUser();
      if (!readyRef.current || !userRef.current) {
        setActiveStep("load-client");
        await waitForClientReady({ readyRef, userRef });
      }
      assertSetupUser(expected);

      if (findHostedPrivyPasskeyCredentialIds(userRef.current).length === 0) {
        setActiveStep("create-passkey");
        await linkWithPasskey();
        await waitForUserState(
          userRef,
          (current) => findHostedPrivyPasskeyCredentialIds(current).length > 0,
          stepLabel("create-passkey"),
        );
      }

      assertSetupUser(expected);

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
      assertSetupUser(expected);
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
        assertSetupUser(expected);
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

      if (
        !walletsReadyRef.current
        || !hasConnectedEmbeddedWallet(walletsRef.current, currentWallet.wallet.address)
      ) {
        setActiveStep("load-client");
        await waitForConnectedWallet(
          { walletsReadyRef, walletsRef },
          currentWallet.wallet.address,
        );
      }

      assertSetupUser(expected);
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
    ensureExistingFactor,
    loginForSetup,
    error,
    pendingLabel: activeStep ? `${stepLabel(activeStep)}…` : null,
    ready,
    walletAddress: walletSelection.status === "ready" ? walletSelection.wallet.address : null,
  };
}

function hasConnectedEmbeddedWallet(
  wallets: ConnectedWallet[],
  address: string,
): boolean {
  const normalizedAddress = address.toLowerCase();
  return wallets.some((wallet) => (
    wallet.linked
    && (wallet.walletClientType === "privy" || wallet.walletClientType === "privy-v2")
    && wallet.address.toLowerCase() === normalizedAddress
  ));
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
    allowSignedOut?: boolean;
  },
  timeoutMs = 10_000,
  intervalMs = 50,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (state.readyRef.current) {
      if (state.userRef.current || state.allowSignedOut) {
        return;
      }
      throw new Error("Sign in on this device to continue.");
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

async function waitForConnectedWallet(
  state: {
    walletsReadyRef: { current: boolean };
    walletsRef: { current: ConnectedWallet[] };
  },
  address: string,
  timeoutMs = 10_000,
  intervalMs = 50,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (
      state.walletsReadyRef.current
      && hasConnectedEmbeddedWallet(state.walletsRef.current, address)
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Secure approval is still loading. Try again in a moment.");
}
