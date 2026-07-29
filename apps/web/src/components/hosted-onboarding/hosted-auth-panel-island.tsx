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

type HostedAuthPanelIslandProps = ComponentProps<typeof HostedAuthPanel>;
type HostedPrivyReadinessEvent =
  | "hosted_auth_privy_ready_retry"
  | "hosted_auth_privy_ready_timeout";

export function HostedPrivyReadinessState({
  onRetry,
  timedOut,
}: {
  onRetry: () => void;
  timedOut: boolean;
}) {
  if (!timedOut) {
    return (
      <div
        aria-live="polite"
        className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3"
      >
        <Spinner className="mt-0.5 shrink-0" />
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
    <Alert variant="destructive">
      <AlertTitle>Sign in didn&apos;t load</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          No verification code was sent. Check your connection and try again.
        </p>
        <Button onClick={onRetry} size="sm" type="button" variant="outline">
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export function HostedAuthPanelIsland(props: HostedAuthPanelIslandProps) {
  const [providerAttempt, setProviderAttempt] = useState(0);
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
      <HostedPrivyReadyBoundary
        {...props}
        attempt={providerAttempt + 1}
        onRetry={() => setProviderAttempt((current) => current + 1)}
      />
    </HostedPrivyProvider>
  );
}

function HostedPrivyReadyBoundary({
  attempt,
  onRetry,
  ...props
}: HostedAuthPanelIslandProps & {
  attempt: number;
  onRetry: () => void;
}) {
  const { ready } = usePrivy();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (ready) return;

    const timeoutId = window.setTimeout(() => {
      setTimedOut(true);
      reportHostedPrivyReadiness("hosted_auth_privy_ready_timeout", attempt);
    }, HOSTED_PRIVY_READY_TIMEOUT_MS);

    return () => window.clearTimeout(timeoutId);
  }, [attempt, ready]);

  if (ready) {
    return <HostedAuthPanel {...props} />;
  }

  return (
    <HostedPrivyReadinessState
      onRetry={() => {
        reportHostedPrivyReadiness("hosted_auth_privy_ready_retry", attempt);
        onRetry();
      }}
      timedOut={timedOut}
    />
  );
}

function reportHostedPrivyReadiness(
  event: HostedPrivyReadinessEvent,
  attempt: number,
) {
  try {
    track(event, {
      attempt,
      online:
        typeof navigator.onLine === "boolean" ? navigator.onLine : "unknown",
    });
  } catch {
    // Diagnostics are best-effort and must never block authentication recovery.
  }
}
