"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/src/components/ui/button";

const AUTO_CONTINUE_SECONDS = 5;

type LauncherState = "waiting" | "connecting" | "failed";

interface IntegrationsConnectLauncherProps {
  claim: string;
}

interface IntegrationsConnectLauncherViewProps {
  autoContinueEnabled: boolean;
  onContinue?: () => void;
  onPause?: () => void;
  state: LauncherState;
}

export function IntegrationsConnectLauncher({
  claim,
}: IntegrationsConnectLauncherProps) {
  // Starting consumes the single-use claim. Guard the timeout and button paths
  // so they can never race into two POSTs.
  const hasStartedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [autoContinueEnabled, setAutoContinueEnabled] = useState(true);
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

    const clearPendingTimeout = () => {
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
      timeout = window.setTimeout(
        () => void startConnection(),
        AUTO_CONTINUE_SECONDS * 1_000,
      );
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
      autoContinueEnabled={autoContinueEnabled}
      onContinue={() => void startConnection()}
      onPause={() => setAutoContinueEnabled(false)}
      state={state}
    />
  );
}

export function IntegrationsConnectLauncherView({
  autoContinueEnabled,
  onContinue,
  onPause,
  state,
}: IntegrationsConnectLauncherViewProps) {
  if (state === "failed") {
    return (
      <p
        className="mt-8 max-w-lg text-sm leading-6 text-muted-foreground text-pretty"
        role="alert"
      >
        Could not start the connection. Refresh to try again, or ask Murph for a new link.
      </p>
    );
  }

  if (state === "connecting") {
    return (
      <p
        aria-live="polite"
        className="mt-8 max-w-lg text-sm leading-6 text-muted-foreground text-pretty"
        role="status"
      >
        Opening Composio…
      </p>
    );
  }

  return (
    <div className="mt-8 flex flex-col items-center gap-4">
      <p
        aria-live="polite"
        className="max-w-lg text-sm leading-6 text-muted-foreground text-pretty"
      >
        {autoContinueEnabled
          ? `Continuing in ${AUTO_CONTINUE_SECONDS} seconds…`
          : "Automatic continuation paused."}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={onContinue} type="button">
          Continue now
        </Button>
        {autoContinueEnabled ? (
          <Button onClick={onPause} type="button" variant="ghost">
            Stay here
          </Button>
        ) : null}
      </div>
    </div>
  );
}
