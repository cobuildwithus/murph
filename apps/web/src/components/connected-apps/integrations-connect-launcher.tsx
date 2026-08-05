"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/src/components/ui/button";

const AUTO_CONTINUE_SECONDS = 5;

type LauncherState = "waiting" | "connecting" | "failed";

interface IntegrationsConnectLauncherProps {
  claim: string;
}

interface IntegrationsConnectLauncherViewProps {
  onContinue?: () => void;
  state: LauncherState;
}

export function IntegrationsConnectLauncher({
  claim,
}: IntegrationsConnectLauncherProps) {
  // Starting consumes the single-use claim. Guard the timeout and button paths
  // so they can never race into two POSTs.
  const hasStartedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
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
    const timeout = window.setTimeout(
      () => void startConnection(),
      AUTO_CONTINUE_SECONDS * 1_000,
    );

    return () => {
      window.clearTimeout(timeout);
      abortControllerRef.current?.abort();
    };
  }, [startConnection]);

  return (
    <IntegrationsConnectLauncherView
      onContinue={() => void startConnection()}
      state={state}
    />
  );
}

export function IntegrationsConnectLauncherView({
  onContinue,
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
      <p className="max-w-lg text-sm leading-6 text-muted-foreground text-pretty">
        Continuing in {AUTO_CONTINUE_SECONDS} seconds…
      </p>
      <Button onClick={onContinue} type="button">
        Continue now
      </Button>
    </div>
  );
}
