"use client";

import { Fingerprint } from "lucide-react";

import { useLegacyWalletApproval } from "@/src/components/sensitive-actions/legacy-wallet-approval-context";
import { Button } from "@/src/components/ui/button";
import type { HostedSecureApprovalStatus } from "@/src/lib/sensitive-actions/shared";
import { useApprovalPasskeyEnrollment } from "@/src/components/sensitive-actions/use-approval-passkey-enrollment";
import { cn } from "@/src/lib/utils";

import { ApprovalPasskeyStatus, ApprovalPasskeyUpdate } from "./approval-passkey-status";
import { SettingsStatusLine } from "./connected-account-card";

export function HostedPasskeySettings({
  authenticated,
  enrollmentEnabled = false,
  secureApprovalStatus,
}: {
  authenticated: boolean;
  enrollmentEnabled?: boolean;
  secureApprovalStatus: HostedSecureApprovalStatus;
}) {
  if (!authenticated) {
    return null;
  }

  if (secureApprovalStatus.method === "passkey") {
    return <ApprovalPasskeyStatus />;
  }
  if (secureApprovalStatus.method === "initial") return <InitialPasskeySetup enrollmentEnabled={enrollmentEnabled} />;
  return <PasskeySetup enrollmentEnabled={enrollmentEnabled} secureApprovalStatus={secureApprovalStatus} />;
}

function InitialPasskeySetup({ enrollmentEnabled }: { enrollmentEnabled: boolean }) {
  const enrollment = useApprovalPasskeyEnrollment();
  return (
    <div className="flex flex-col gap-3 py-4">
      <p className="text-sm leading-relaxed text-muted-foreground">
        Add a passkey to approve account changes and other protected actions.
      </p>
      {enrollment.registered ? <SettingsStatusLine message="Your passkey is ready." tone="success" /> : (
        <Button className="self-start" disabled={!enrollmentEnabled || enrollment.pending} type="button" onClick={() => void enrollment.enroll()}>
          {enrollment.pending ? "Setting up…" : "Set up passkey"}
        </Button>
      )}
      {enrollment.error ? <SettingsStatusLine message={enrollment.error} tone="destructive" /> : null}
    </div>
  );
}

function PasskeySetup({
  enrollmentEnabled,
  secureApprovalStatus,
}: {
  enrollmentEnabled: boolean;
  secureApprovalStatus: HostedSecureApprovalStatus;
}) {
  const {
    clientAuthenticated,
    configured,
    ensureConfigured,
    loginForSetup,
    error,
    pendingLabel,
    ready,
  } = useLegacyWalletApproval().setup;
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
                    onClick={() => void loginForSetup()}
                  >
                    Verify existing sign-in
                  </Button>
                </div>
              )
          : null}
      </div>
      {effectiveConfigured && enrollmentEnabled ? <ApprovalPasskeyMigration /> : null}
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
  secureApprovalStatus: HostedSecureApprovalStatus;
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

function ApprovalPasskeyMigration() {
  const enrollment = useApprovalPasskeyEnrollment();
  return <ApprovalPasskeyUpdate {...enrollment} onUpdate={() => void enrollment.enroll()} />;
}
