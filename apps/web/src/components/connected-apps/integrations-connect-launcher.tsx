"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { LinkPageContactPill } from "@/src/components/link-page/link-page-contact";
import { LinkPagePair } from "@/src/components/link-page/link-page-pair";
import {
  LINK_PAGE_PILL_CLASS,
  LinkPageLink,
  LinkPagePill,
  LinkPageScreen,
} from "@/src/components/link-page/link-page-shell";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";
import { cn } from "@/src/lib/utils";

const AUTO_CONTINUE_SECONDS = 5;

type LauncherState = "waiting" | "connecting" | "failed";

interface IntegrationsConnectLauncherProps {
  accountLabel: string;
  claim: string;
  logoSrc: string | null;
}

interface IntegrationsConnectLauncherViewProps {
  accountLabel: string;
  autoContinueEnabled: boolean;
  logoSrc: string | null;
  onContinue?: () => void;
  onPause?: () => void;
  onRetry?: () => void;
  secondsLeft?: number;
  state: LauncherState;
}

export function IntegrationsConnectLauncher({
  accountLabel,
  claim,
  logoSrc,
}: IntegrationsConnectLauncherProps) {
  // Starting consumes the single-use claim. Guard the timeout and button paths
  // so they can never race into two POSTs.
  const hasStartedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [autoContinueEnabled, setAutoContinueEnabled] = useState(true);
  const [secondsLeft, setSecondsLeft] = useState(AUTO_CONTINUE_SECONDS);
  const [state, setState] = useState<LauncherState>("waiting");

  const startConnection = useCallback(async () => {
    if (hasStartedRef.current) {
      return;
    }
    hasStartedRef.current = true;
    setState("connecting");

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch(
        `/integrations/connect/${encodeURIComponent(claim)}/start`,
        {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          method: "POST",
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted) {
        return;
      }
      if (!response.ok) {
        setState("failed");
        return;
      }

      const data = (await response.json()) as { redirectUrl?: unknown };
      if (controller.signal.aborted) {
        return;
      }
      if (
        typeof data.redirectUrl !== "string"
        || data.redirectUrl.length === 0
      ) {
        setState("failed");
        return;
      }

      window.location.href = data.redirectUrl;
    } catch {
      if (!controller.signal.aborted) {
        setState("failed");
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  }, [claim]);

  useEffect(() => {
    return () => abortControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    let timeout: number | null = null;
    let tick: number | null = null;

    const clearPendingTimeout = () => {
      if (tick !== null) {
        window.clearInterval(tick);
        tick = null;
      }
      if (timeout === null) {
        return;
      }
      window.clearTimeout(timeout);
      timeout = null;
    };

    const armTimeout = () => {
      clearPendingTimeout();
      if (
        !autoContinueEnabled
        || document.visibilityState !== "visible"
        || hasStartedRef.current
      ) {
        return;
      }
      // The timeout alone starts the connection; the tick only draws the pill.
      setSecondsLeft(AUTO_CONTINUE_SECONDS);
      tick = window.setInterval(
        () => setSecondsLeft((seconds) => Math.max(1, seconds - 1)),
        1_000,
      );
      timeout = window.setTimeout(() => {
        clearPendingTimeout();
        void startConnection();
      }, AUTO_CONTINUE_SECONDS * 1_000);
    };

    armTimeout();
    document.addEventListener("visibilitychange", armTimeout);

    return () => {
      document.removeEventListener("visibilitychange", armTimeout);
      clearPendingTimeout();
    };
  }, [autoContinueEnabled, startConnection]);

  return (
    <IntegrationsConnectLauncherView
      accountLabel={accountLabel}
      autoContinueEnabled={autoContinueEnabled}
      logoSrc={logoSrc}
      onContinue={() => void startConnection()}
      onPause={() => setAutoContinueEnabled(false)}
      onRetry={() => window.location.reload()}
      secondsLeft={secondsLeft}
      state={state}
    />
  );
}

export function IntegrationsConnectLauncherView({
  accountLabel,
  autoContinueEnabled,
  logoSrc,
  onContinue,
  onPause,
  onRetry,
  secondsLeft = AUTO_CONTINUE_SECONDS,
  state,
}: IntegrationsConnectLauncherViewProps) {
  const pair = <LinkPagePair logoSrc={logoSrc} name={accountLabel} />;

  if (state === "failed") {
    return (
      <LinkPageScreen
        actions={<LinkPagePill onClick={onRetry}>Try again</LinkPagePill>}
        announceDetail={false}
        detail={<span role="alert">Try again, or ask Murph for a new link.</span>}
        title={`${accountLabel} didn’t connect.`}
      >
        {pair}
      </LinkPageScreen>
    );
  }

  const title = `Connect ${accountLabel}.`;
  const detail = "You’ll review and approve access on the next screen, through Composio.";

  if (state === "connecting") {
    return (
      <LinkPageScreen
        actions={
          <p
            aria-live="polite"
            className={cn(LINK_PAGE_PILL_CLASS, "bg-[#FFFCF6]/30")}
            role="status"
          >
            Opening…
          </p>
        }
        announceDetail={false}
        detail={detail}
        title={title}
      >
        {pair}
      </LinkPageScreen>
    );
  }

  return (
    <LinkPageScreen
      actions={
        <>
          <p aria-live="polite" className="sr-only">
            {autoContinueEnabled
              ? `Continuing in ${AUTO_CONTINUE_SECONDS} seconds…`
              : "Automatic continuation paused."}
          </p>
          <LinkPagePill aria-label="Continue now" onClick={onContinue}>
            {autoContinueEnabled ? `Continuing in ${secondsLeft}` : "Continue"}
          </LinkPagePill>
          {autoContinueEnabled ? (
            <LinkPageLink onClick={onPause}>Stay here</LinkPageLink>
          ) : null}
        </>
      }
      announceDetail={false}
      detail={detail}
      title={title}
    >
      {pair}
    </LinkPageScreen>
  );
}

export function IntegrationsConnectUnavailableScreen({
  contactOption,
  detail,
  title,
}: {
  contactOption: MurphContactOption | null;
  detail: string;
  title: string;
}) {
  return (
    <LinkPageScreen
      actions={contactOption ? <LinkPageContactPill option={contactOption} /> : undefined}
      detail={detail}
      title={title}
    />
  );
}
