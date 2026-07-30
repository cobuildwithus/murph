"use client";

import { track } from "@vercel/analytics";
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";

import { Button } from "@/src/components/ui/button";
import { Spinner } from "@/src/components/ui/spinner";

import { HostedAuthPanel } from "./hosted-auth-panel";
import { HostedPrivyProvider } from "./privy-provider";

const HOSTED_PRIVY_SLOW_READY_NOTICE_MS = 1_500;
const HOSTED_PRIVY_READY_TIMEOUT_MS = 10_000;
const HOSTED_PRIVY_RESTART_TIMEOUT_COUNT = 2;

type HostedAuthPanelProps = ComponentProps<typeof HostedAuthPanel>;
type HostedPrivyReadinessEvent =
  | "hosted_auth_privy_ready_restart"
  | "hosted_auth_privy_ready_timeout";

export function HostedPrivyReadinessState({
  onRestart,
  restartAvailable,
}: {
  onRestart: () => void;
  restartAvailable: boolean;
}) {
  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      role="status"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs leading-relaxed text-muted-foreground"
    >
      <Spinner aria-hidden="true" className="size-3.5 shrink-0" />
      <span>
        Your selection is saved while secure sign in finishes loading.
      </span>
      {restartAvailable ? (
        <Button
          className="h-auto p-0 text-xs"
          onClick={onRestart}
          size="xs"
          type="button"
          variant="link"
        >
          Restart sign in
        </Button>
      ) : null}
    </div>
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
  const [authActionActive, setAuthActionActive] = useState(false);
  const [restartRequested, setRestartRequested] = useState(false);

  function handleRestart() {
    setRestartRequested(true);
    onRestartPrivy();
  }

  return (
    <>
      {!restartRequested ? (
        <HostedAuthPanel
          {...props}
          onPrivyWaitChange={setAuthActionActive}
        />
      ) : null}
      {!restartRequested && authActionActive ? (
        <HostedPrivyReadinessFeedback
          attempt={privyAttempt}
          onRestart={handleRestart}
        />
      ) : null}
    </>
  );
}

function HostedPrivyReadinessFeedback({
  attempt,
  onRestart,
}: {
  attempt: number;
  onRestart: () => void;
}) {
  const [noticeVisible, setNoticeVisible] = useState(false);
  const [timeoutCount, setTimeoutCount] = useState(0);
  const timeoutCountRef = useRef(0);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setNoticeVisible(true);
    }, HOSTED_PRIVY_SLOW_READY_NOTICE_MS);

    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (timeoutCount >= HOSTED_PRIVY_RESTART_TIMEOUT_COUNT) return;

    const timeoutId = window.setTimeout(() => {
      const nextTimeoutCount = timeoutCountRef.current + 1;
      timeoutCountRef.current = nextTimeoutCount;
      setTimeoutCount(nextTimeoutCount);
      reportHostedPrivyReadiness(
        "hosted_auth_privy_ready_timeout",
        attempt,
        nextTimeoutCount,
      );
    }, HOSTED_PRIVY_READY_TIMEOUT_MS);

    return () => window.clearTimeout(timeoutId);
  }, [attempt, timeoutCount]);

  return noticeVisible ? (
    <HostedPrivyReadinessState
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
    />
  ) : null;
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
