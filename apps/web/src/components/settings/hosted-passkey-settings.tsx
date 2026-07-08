"use client";

import { Fingerprint } from "lucide-react";

import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { usePasskeyWalletMfa } from "@/src/components/sensitive-actions/use-passkey-wallet-mfa";
import { Button } from "@/src/components/ui/button";
import type { HostedPrivyWalletMfaStatus } from "@/src/lib/hosted-onboarding/privy-wallet-mfa";
import { cn } from "@/src/lib/utils";

import { SettingsStatusLine } from "./connected-account-card";

export function HostedPasskeySettings({
  authenticated,
  secureApprovalStatus,
}: {
  authenticated: boolean;
  secureApprovalStatus: HostedPrivyWalletMfaStatus;
}) {
  if (!authenticated) {
    return null;
  }

  return <PasskeySetup secureApprovalStatus={secureApprovalStatus} />;
}

function PasskeySetup({
  secureApprovalStatus,
}: {
  secureApprovalStatus: HostedPrivyWalletMfaStatus;
}) {
  const { openAuthDialog } = useAuth();
  const {
    clientAuthenticated,
    configured,
    ensureConfigured,
    error,
    pendingLabel,
    ready,
  } = usePasskeyWalletMfa();
  const isRunning = pendingLabel !== null;
  const serverConfigured = secureApprovalStatus.status === "configured";
  const effectiveConfigured = serverConfigured || configured;
  const needsClientAuth = ready && !clientAuthenticated;
  const canStartSetup =
    ready
    && clientAuthenticated
    && !effectiveConfigured
    && secureApprovalStatus.status === "not_configured";
  const showReauthAction =
    needsClientAuth
    && !effectiveConfigured
    && secureApprovalStatus.status === "not_configured";
  const valueText = effectiveConfigured
    ? "Enabled"
    : secureApprovalStatus.status === "needs_support"
      ? "Needs support"
      : secureApprovalStatus.status === "unavailable"
        ? "Unavailable"
    : !ready
      ? "Checking…"
      : "Not set up";
  const statusMessage = resolveStatusMessage({
    clientAuthenticated,
    error,
    pendingLabel,
    ready,
    secureApprovalStatus,
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-4 first:pt-0 last:pb-0">
        <Fingerprint
          className={cn(
            "size-[18px] shrink-0",
            effectiveConfigured ? "text-[#7a8c6e]" : "text-muted-foreground",
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
              effectiveConfigured ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {valueText}
          </p>
        </div>
        {canStartSetup
          ? (
              <div className="shrink-0">
                <Button
                  type="button"
                  size="default"
                  variant="default"
                  disabled={isRunning}
                  onClick={() => void ensureConfigured().catch(() => undefined)}
                >
                  {isRunning ? "Setting up…" : "Set up"}
                </Button>
              </div>
            )
          : showReauthAction
            ? (
                <div className="shrink-0">
                  <Button
                    type="button"
                    size="default"
                    variant="default"
                    disabled={isRunning}
                    onClick={openAuthDialog}
                  >
                    Sign in
                  </Button>
                </div>
              )
          : null}
      </div>
      {statusMessage
        ? <SettingsStatusLine message={statusMessage.message} tone={statusMessage.tone} />
          : null}
    </div>
  );
}

function resolveStatusMessage(input: {
  clientAuthenticated: boolean;
  error: string | null;
  pendingLabel: string | null;
  ready: boolean;
  secureApprovalStatus: HostedPrivyWalletMfaStatus;
}): { message: string; tone: "destructive" | "neutral" } | null {
  if (input.error) {
    return { message: input.error, tone: "destructive" };
  }

  if (input.pendingLabel) {
    return { message: input.pendingLabel, tone: "neutral" };
  }

  if (input.secureApprovalStatus.status === "needs_support") {
    return {
      message: "Something looks off with your secure setup. Contact support before continuing.",
      tone: "destructive",
    };
  }

  if (input.secureApprovalStatus.status === "unavailable") {
    return {
      message: "Secure approval status is temporarily unavailable. Try again in a moment.",
      tone: "destructive",
    };
  }

  if (
    input.ready
    && !input.clientAuthenticated
    && input.secureApprovalStatus.status === "not_configured"
  ) {
    return {
      message: "Sign in on this device to manage secure approvals.",
      tone: "neutral",
    };
  }

  return null;
}
