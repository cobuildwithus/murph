"use client";

import { track } from "@vercel/analytics";
import { ArrowUpRight, CheckCircle2, Keyboard, Monitor } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ComputerHandoffFloatingIsland } from "@/src/components/computer-use/computer-handoff-floating-island";
import { Button, buttonVariants } from "@/src/components/ui/button";
import { MurphPulseLoader } from "@/src/components/ui/murph-pulse-loader";
import { cn } from "@/src/lib/utils";

type Phase =
  | { kind: "idle"; error: string | null }
  | { kind: "saving" }
  | { kind: "done"; redirectTo: string };

interface ComputerHandoffActiveViewProps {
  description?: string;
  doneEndpoint: string;
  iframeAllow: string;
  liveViewUrl: string;
  title?: string;
}

export function ComputerHandoffActiveView({
  description = "Take over to finish this step. Use the keyboard icon in the browser to type or paste.",
  doneEndpoint,
  iframeAllow,
  liveViewUrl,
  title = "Your turn",
}: ComputerHandoffActiveViewProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle", error: null });
  const [takeoverStarted, setTakeoverStarted] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const successAnchorRef = useRef<HTMLAnchorElement>(null);
  const phaseRef = useRef(phase);
  const terminalRef = useRef(false);
  const focusReportedRef = useRef(false);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    if (phase.kind === "done") {
      successAnchorRef.current?.focus();
    }
  }, [phase.kind]);

  useEffect(() => {
    const onPageHide = () => {
      if (terminalRef.current) return;
      if (phaseRef.current.kind !== "idle") return;
      terminalRef.current = true;
      track("handoff_abandoned");
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  const focusLiveView = () => {
    iframeRef.current?.focus({ preventScroll: true });
    if (!focusReportedRef.current) {
      focusReportedRef.current = true;
      track("live_view_focus_enabled");
    }
  };

  const onTakeOver = () => {
    focusLiveView();
    setTakeoverStarted(true);
  };

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
      terminalRef.current = true;
      track("handoff_completed");
      setPhase({ kind: "done", redirectTo: data.redirectTo });
      window.location.href = data.redirectTo;
    } catch {
      setPhase({ kind: "idle", error: "Could not complete. Try again." });
    }
  };

  const controlsDisabled = phase.kind !== "idle";
  const idleError = phase.kind === "idle" ? phase.error : null;
  const showBrowserSurface = phase.kind === "idle";

  return (
    <>
      {showBrowserSurface ? (
        <>
          <div className="fixed left-0 top-0 h-dvh w-full bg-foreground">
            <iframe
              ref={iframeRef}
              allow={iframeAllow}
              aria-hidden={!takeoverStarted}
              className="block h-full w-full border-0 bg-foreground"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
              src={liveViewUrl}
              tabIndex={takeoverStarted ? 0 : -1}
              title="Murph private page"
            />
          </div>
          {!takeoverStarted && phase.kind === "idle" ? (
            <div
              aria-describedby="computer-handoff-takeover-description"
              aria-labelledby="computer-handoff-takeover-title"
              aria-modal="true"
              className="fixed inset-0 z-10 flex min-h-dvh items-center justify-center bg-background px-6 py-12 text-foreground"
              role="dialog"
            >
              <div className="flex w-full max-w-sm flex-col items-center text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card">
                  <Monitor className="h-5 w-5 text-primary" aria-hidden="true" />
                </span>
                <p className="mt-5 font-mono text-xs uppercase tracking-wide text-muted-foreground">
                  Private browser
                </p>
                <h1
                  id="computer-handoff-takeover-title"
                  className="mt-3 font-serif text-3xl leading-tight text-balance"
                >
                  {title}
                </h1>
                <p
                  id="computer-handoff-takeover-description"
                  className="mt-4 text-sm leading-6 text-muted-foreground text-pretty"
                >
                  {description}
                </p>
                <Button
                  type="button"
                  size="lg"
                  className="mt-8 w-full"
                  onClick={onTakeOver}
                  aria-label="Take over the private browser"
                >
                  Take over
                </Button>
              </div>
            </div>
          ) : null}
          {takeoverStarted ? (
            <div
              className="pointer-events-none fixed inset-x-0 bottom-0 z-10 flex justify-center px-3 pb-3"
              style={{
                paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)",
              }}
            >
              <ComputerHandoffFloatingIsland
                handle={
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Monitor className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                  </span>
                }
              >
                <div className="flex max-w-[calc(100vw-6rem)] flex-wrap items-center gap-2">
                  {idleError ? (
                    <span role="alert" className="text-xs text-destructive">
                      {idleError}
                    </span>
                  ) : null}
                  <Button
                    type="button"
                    size="lg"
                    onClick={onDone}
                    disabled={controlsDisabled}
                    aria-label="Finish this step and return to Murph"
                  >
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    Done
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon-lg"
                    className="hidden size-11 rounded-2xl sm:inline-flex"
                    onClick={focusLiveView}
                    disabled={controlsDisabled}
                    aria-label="Focus the private browser"
                    title="Focus browser"
                  >
                    <Keyboard className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </ComputerHandoffFloatingIsland>
            </div>
          ) : null}
        </>
      ) : null}
      {phase.kind === "saving" ? (
        <div
          aria-busy
          aria-live="polite"
          role="status"
          className="fixed inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-background px-6 py-12 text-foreground"
        >
          <MurphPulseLoader className="h-8 w-auto" />
          <p className="text-sm font-medium text-muted-foreground">
            Saving your progress...
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
            aria-label="Open Murph"
          >
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            Open Murph
          </a>
        </div>
      ) : null}
    </>
  );
}
