"use client";

import { usePrivy } from "@privy-io/react-auth";
import { track } from "@vercel/analytics";
import { useEffect, useState, type ComponentProps } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import { Spinner } from "@/src/components/ui/spinner";

import { HostedAuthPanel } from "./hosted-auth-panel";
import { HostedPrivyProvider } from "./privy-provider";

const HOSTED_PRIVY_READY_TIMEOUT_MS = 10_000;
const HOSTED_PRIVY_RESTART_TIMEOUT_COUNT = 2;

type HostedAuthPanelProps = ComponentProps<typeof HostedAuthPanel>;
type HostedPrivyReadinessEvent =
  | "hosted_auth_privy_ready_continue_waiting"
  | "hosted_auth_privy_ready_restart"
  | "hosted_auth_privy_ready_timeout";

export function HostedPrivyReadinessState({
  onKeepWaiting,
  onRestart,
  restartAvailable,
  timedOut,
}: {
  onKeepWaiting: () => void;
  onRestart: () => void;
  restartAvailable: boolean;
  timedOut: boolean;
}) {
  if (!timedOut) {
    return (
      <div
        aria-atomic="true"
        aria-live="polite"
        role="status"
        className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3"
      >
        <Spinner aria-hidden="true" className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            Preparing secure sign in
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            This should take only a moment.
          </p>
        </div>
      </div>
    );
  }

  return (
    <Alert>
      <AlertTitle>Sign in is taking longer</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          Nothing was submitted. You can keep waiting
          {restartAvailable ? " or restart secure sign in." : "."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onKeepWaiting} size="sm" type="button">
            Keep waiting
          </Button>
          {restartAvailable ? (
            <Button
              onClick={onRestart}
              size="sm"
              type="button"
              variant="outline"
            >
              Restart sign in
            </Button>
          ) : null}
        </div>
      </AlertDescription>
    </Alert>
  );
}

export function HostedAuthPanelIsland(props: HostedAuthPanelProps) {
  const [providerAttempt, setProviderAttempt] = useState(1);
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const clientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim() || null;

  if (!appId) {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
        Sign in is not configured yet.
      </div>
    );
  }

  return (
    <HostedPrivyProvider
      appId={appId}
      clientId={clientId}
      key={providerAttempt}
    >
      <HostedAuthPanelWithinPrivy
        {...props}
        privyAttempt={providerAttempt}
        onRestartPrivy={() => setProviderAttempt((current) => current + 1)}
      />
    </HostedPrivyProvider>
  );
}

export function HostedAuthPanelWithinPrivy({
  onRestartPrivy,
  privyAttempt,
  ...props
}: HostedAuthPanelProps & {
  onRestartPrivy: () => void;
  privyAttempt: number;
}) {
  return (
    <HostedPrivyReadyBoundary
      {...props}
      attempt={privyAttempt}
      onRestart={onRestartPrivy}
    />
  );
}

function HostedPrivyReadyBoundary({
  attempt,
  onRestart,
  ...props
}: HostedAuthPanelProps & {
  attempt: number;
  onRestart: () => void;
}) {
  const { ready } = usePrivy();
  const [timedOut, setTimedOut] = useState(false);
  const [timeoutCount, setTimeoutCount] = useState(0);

  useEffect(() => {
    if (ready || timedOut) return;

    const timeoutId = window.setTimeout(() => {
      const nextTimeoutCount = timeoutCount + 1;
      setTimedOut(true);
      setTimeoutCount(nextTimeoutCount);
      reportHostedPrivyReadiness(
        "hosted_auth_privy_ready_timeout",
        attempt,
        nextTimeoutCount,
      );
    }, HOSTED_PRIVY_READY_TIMEOUT_MS);

    return () => window.clearTimeout(timeoutId);
  }, [attempt, ready, timedOut, timeoutCount]);

  if (ready) {
    return <HostedAuthPanel {...props} />;
  }

  return (
    <HostedPrivyReadinessState
      onKeepWaiting={() => {
        reportHostedPrivyReadiness(
          "hosted_auth_privy_ready_continue_waiting",
          attempt,
          timeoutCount,
        );
        setTimedOut(false);
      }}
      onRestart={() => {
        reportHostedPrivyReadiness(
          "hosted_auth_privy_ready_restart",
          attempt,
          timeoutCount,
        );
        onRestart();
      }}
      restartAvailable={
        timeoutCount >= HOSTED_PRIVY_RESTART_TIMEOUT_COUNT
      }
      timedOut={timedOut}
    />
  );
}

function reportHostedPrivyReadiness(
  event: HostedPrivyReadinessEvent,
  attempt: number,
  timeoutCount: number,
) {
  if (
    window.location.pathname !== "/"
    || window.location.search !== ""
    || window.location.hash !== ""
  ) {
    return;
  }

  try {
    track(event, {
      attempt,
      online:
        typeof navigator.onLine === "boolean" ? navigator.onLine : "unknown",
      timeoutCount,
    });
  } catch {
    // Diagnostics are best-effort and must never block authentication recovery.
  }
}
