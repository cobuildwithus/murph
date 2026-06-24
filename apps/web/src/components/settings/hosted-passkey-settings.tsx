"use client";

import {
  type User,
  useCreateWallet,
  useLinkWithPasskey,
  useMfaEnrollment,
  usePrivy,
} from "@privy-io/react-auth";
import { Fingerprint } from "lucide-react";
import { useRef, useState } from "react";

import { HostedPrivyProvider } from "@/src/components/hosted-onboarding/privy-provider";
import { Button } from "@/src/components/ui/button";
import { cn } from "@/src/lib/utils";

import { SettingsStatusLine } from "./connected-account-card";

export function HostedPasskeySettings({ authenticated }: { authenticated: boolean }) {
  if (!authenticated) {
    return null;
  }

  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const clientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim() || null;

  if (!appId) {
    return null;
  }

  return (
    <HostedPrivyProvider appId={appId} clientId={clientId}>
      <PasskeySetup />
    </HostedPrivyProvider>
  );
}

type SetupStep = "create-passkey" | "create-wallet" | "enroll-mfa";

function PasskeySetup() {
  const { user, ready } = usePrivy();
  const { linkWithPasskey } = useLinkWithPasskey();
  const { createWallet } = useCreateWallet();
  const { initEnrollmentWithPasskey, submitEnrollmentWithPasskey } = useMfaEnrollment();

  // The setup handler chains Privy calls and reads `user` after each one to advance.
  // The `user` captured by the handler closure is stale after an `await`, since React
  // hasn't re-rendered yet. A ref kept in sync each render gives the handler a fresh
  // window into Privy's user state without waiting for React to commit.
  const userRef = useRef<User | null>(user);
  userRef.current = user;

  const [activeStep, setActiveStep] = useState<SetupStep | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasPasskeyMfa = user?.mfaMethods.includes("passkey") ?? false;
  const isRunning = activeStep !== null;
  const showAction = ready && !hasPasskeyMfa;
  const valueText = hasPasskeyMfa
    ? "Enabled"
    : !ready
      ? "Checking…"
      : "Not configured";

  async function handleSetup() {
    setError(null);
    try {
      if (!findPasskey(userRef.current)) {
        setActiveStep("create-passkey");
        await linkWithPasskey();
        await waitForUserState(
          userRef,
          (u) => findPasskey(u) !== undefined,
          stepLabel("create-passkey"),
        );
      }
      if (!hasEmbeddedWallet(userRef.current)) {
        setActiveStep("create-wallet");
        await createWallet();
        await waitForUserState(
          userRef,
          hasEmbeddedWallet,
          stepLabel("create-wallet"),
        );
      }
      if (!userRef.current?.mfaMethods.includes("passkey")) {
        setActiveStep("enroll-mfa");
        const passkey = findPasskey(userRef.current);
        if (!passkey) {
          throw new Error("Passkey not found after creation.");
        }
        await initEnrollmentWithPasskey();
        await submitEnrollmentWithPasskey(
          { credentialIds: [passkey.credentialId] },
          // Keeps the passkey usable as a login method too. Switch to true only after we
          // also gate enrollment on "user has at least one non-passkey login method".
          { removeForLogin: false },
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Setup failed. Try again.");
    } finally {
      setActiveStep(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-4 first:pt-0 last:pb-0">
        <Fingerprint
          className={cn(
            "size-[18px] shrink-0",
            hasPasskeyMfa ? "text-[#7a8c6e]" : "text-muted-foreground",
          )}
          strokeWidth={1.6}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <span className="font-mono text-[10px] uppercase tracking-[0.11em] text-muted-foreground">
            Passkey
          </span>
          <p
            className={cn(
              "break-words font-serif text-base tracking-tight",
              hasPasskeyMfa ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {valueText}
          </p>
        </div>
        {showAction
          ? (
              <div className="shrink-0">
                <Button
                  type="button"
                  size="default"
                  variant="default"
                  disabled={isRunning}
                  onClick={() => void handleSetup()}
                >
                  {isRunning ? "Setting up…" : "Set up"}
                </Button>
              </div>
            )
          : null}
      </div>
      {error
        ? <SettingsStatusLine message={error} tone="destructive" />
        : activeStep
          ? <SettingsStatusLine message={`${stepLabel(activeStep)}…`} tone="neutral" />
          : null}
    </div>
  );
}

function stepLabel(step: SetupStep): string {
  switch (step) {
    case "create-passkey":
      return "Creating passkey";
    case "create-wallet":
      return "Setting up secure container";
    case "enroll-mfa":
      return "Enrolling passkey as MFA factor";
  }
}

function findPasskey(user: User | null) {
  return user?.linkedAccounts.find(
    (account): account is typeof account & { type: "passkey"; credentialId: string } =>
      account.type === "passkey",
  );
}

function hasEmbeddedWallet(user: User | null): boolean {
  return user?.linkedAccounts.some((account) => account.type === "wallet") ?? false;
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
