"use client";

import { Fingerprint } from "lucide-react";

import { usePasskeyWalletMfa } from "@/src/components/sensitive-actions/use-passkey-wallet-mfa";
import { Button } from "@/src/components/ui/button";
import { cn } from "@/src/lib/utils";

import { SettingsStatusLine } from "./connected-account-card";

export function HostedPasskeySettings({ authenticated }: { authenticated: boolean }) {
  if (!authenticated) {
    return null;
  }

  return <PasskeySetup />;
}

function PasskeySetup() {
  const {
    configured,
    ensureConfigured,
    error,
    pendingLabel,
    ready,
  } = usePasskeyWalletMfa();
  const isRunning = pendingLabel !== null;
  const showAction = ready && !configured;
  const valueText = configured
    ? "Enabled"
    : !ready
      ? "Checking…"
      : "Not configured";

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-4 first:pt-0 last:pb-0">
        <Fingerprint
          className={cn(
            "size-[18px] shrink-0",
            configured ? "text-[#7a8c6e]" : "text-muted-foreground",
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
              configured ? "text-foreground" : "text-muted-foreground",
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
                  onClick={() => void ensureConfigured().catch(() => undefined)}
                >
                  {isRunning ? "Setting up…" : "Set up"}
                </Button>
              </div>
            )
          : null}
      </div>
      {error
        ? <SettingsStatusLine message={error} tone="destructive" />
        : pendingLabel
          ? <SettingsStatusLine message={pendingLabel} tone="neutral" />
          : null}
    </div>
  );
}
