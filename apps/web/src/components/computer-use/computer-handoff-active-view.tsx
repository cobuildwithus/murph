"use client";

import { ArrowUpRight, CheckCircle2, Monitor } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ComputerHandoffFloatingIsland } from "@/src/components/computer-use/computer-handoff-floating-island";
import { Button, buttonVariants } from "@/src/components/ui/button";
import { MurphPulseLoader } from "@/src/components/ui/murph-pulse-loader";
import { resolveComputerBrowserViewportPreset } from "@/src/lib/computer-use/viewport";
import { cn } from "@/src/lib/utils";

type Phase =
  | { kind: "idle"; error: string | null }
  | { kind: "saving" }
  | { kind: "done"; redirectTo: string };

interface ComputerHandoffActiveViewProps {
  doneEndpoint: string;
  iframeAllow: string;
  liveViewUrl: string;
  viewportEndpoint: string;
}

export function ComputerHandoffActiveView({
  doneEndpoint,
  iframeAllow,
  liveViewUrl,
  viewportEndpoint,
}: ComputerHandoffActiveViewProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle", error: null });
  const [viewportError, setViewportError] = useState<string | null>(null);
  const [viewportReady, setViewportReady] = useState(false);
  const successAnchorRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (phase.kind === "done") {
      successAnchorRef.current?.focus();
    }
  }, [phase.kind]);

  useEffect(() => {
    const abortController = new AbortController();
    const preset = resolveComputerBrowserViewportPreset(window.innerWidth);

    const updateViewport = async () => {
      try {
        const response = await fetch(viewportEndpoint, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preset }),
          signal: abortController.signal,
        });
        if (!response.ok) {
          throw new Error("Viewport update failed.");
        }
      } catch {
        if (abortController.signal.aborted) {
          return;
        }
        setViewportError(
          "Could not fit the browser to this screen. Showing the current view.",
        );
      }
      if (!abortController.signal.aborted) {
        setViewportReady(true);
      }
    };

    void updateViewport();

    return () => {
      abortController.abort();
    };
  }, [viewportEndpoint]);

  const onDone = async () => {
    setPhase({ kind: "saving" });
    try {
      const response = await fetch(doneEndpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        setPhase({ kind: "idle", error: "Could not complete. Try again." });
        return;
      }
      const data = (await response.json()) as { redirectTo?: unknown };
      if (typeof data.redirectTo !== "string" || data.redirectTo.length === 0) {
        setPhase({ kind: "idle", error: "Could not complete. Try again." });
        return;
      }
      setPhase({ kind: "done", redirectTo: data.redirectTo });
      window.location.href = data.redirectTo;
    } catch {
      setPhase({ kind: "idle", error: "Could not complete. Try again." });
    }
  };

  const idleError = phase.kind === "idle" ? phase.error ?? viewportError : null;

  return (
    <>
      {viewportReady ? (
        <>
          <iframe
            allow={iframeAllow}
            className="block h-dvh w-full border-0 bg-foreground"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
            src={liveViewUrl}
            title="Murph private page"
          />
          <div
            className="pointer-events-none fixed inset-x-0 bottom-0 z-10 flex justify-center px-3 pb-3"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
          >
            <ComputerHandoffFloatingIsland
              handle={
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Monitor className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                </span>
              }
            >
              <div className="flex items-center gap-2">
                {idleError ? (
                  <span role="alert" className="text-xs text-destructive">
                    {idleError}
                  </span>
                ) : null}
                <Button
                  type="button"
                  size="lg"
                  onClick={onDone}
                  disabled={phase.kind !== "idle"}
                  aria-label="Mark this done and reply to Murph"
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  Done
                </Button>
              </div>
            </ComputerHandoffFloatingIsland>
          </div>
        </>
      ) : (
        <div
          aria-busy
          aria-live="polite"
          role="status"
          className="flex h-dvh flex-col items-center justify-center gap-6 bg-background px-6 py-12 text-foreground"
        >
          <MurphPulseLoader className="h-24 w-auto" />
          <p className="font-serif text-2xl font-normal text-foreground">
            Preparing your browser
          </p>
        </div>
      )}
      {phase.kind === "saving" ? (
        <div
          aria-busy
          aria-live="polite"
          role="status"
          className="fixed inset-0 z-20 flex flex-col items-center justify-center gap-6 bg-background px-6 py-12 text-foreground"
        >
          <MurphPulseLoader className="h-24 w-auto" />
          <p className="font-serif text-2xl font-normal text-foreground">
            Saving your progress
          </p>
        </div>
      ) : null}
      {phase.kind === "done" ? (
        <div
          aria-live="polite"
          role="status"
          className="fixed inset-0 z-20 flex flex-col items-center justify-center gap-6 bg-background px-6 py-12 text-foreground"
        >
          <CheckCircle2 className="h-8 w-8 text-primary" aria-hidden="true" />
          <p className="font-serif text-2xl font-normal text-foreground">
            All set
          </p>
          <a
            ref={successAnchorRef}
            href={phase.redirectTo}
            className={cn(buttonVariants({ size: "lg" }))}
            aria-label="Open Murph to send your reply"
          >
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            Open Murph
          </a>
        </div>
      ) : null}
    </>
  );
}
