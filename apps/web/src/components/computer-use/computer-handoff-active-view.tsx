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
  doneEndpoint: string;
  iframeAllow: string;
  liveViewUrl: string;
}

export function ComputerHandoffActiveView({
  doneEndpoint,
  iframeAllow,
  liveViewUrl,
}: ComputerHandoffActiveViewProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle", error: null });
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

  const onEnableFocus = () => {
    iframeRef.current?.focus({ preventScroll: true });
    if (!focusReportedRef.current) {
      focusReportedRef.current = true;
      track("live_view_focus_enabled");
    }
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

  const idleError = phase.kind === "idle" ? phase.error : null;
  const showBrowserSurface = phase.kind === "idle" || phase.kind === "saving";

  return (
    <>
      {showBrowserSurface ? (
        <>
          <iframe
            ref={iframeRef}
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
              <div className="flex max-w-[calc(100vw-6rem)] flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
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
                  <Button
                    type="button"
                    variant="secondary"
                    size="lg"
                    onClick={onEnableFocus}
                    disabled={phase.kind !== "idle"}
                    aria-label="Focus the private page so the keyboard and paste work"
                  >
                    <Keyboard className="h-4 w-4" aria-hidden="true" />
                    Keyboard<span className="hidden sm:inline"> / Paste</span>
                  </Button>
                </div>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Copy your password, tap Keyboard / Paste, then paste with the
                  keyboard icon inside the page.
                </p>
              </div>
            </ComputerHandoffFloatingIsland>
          </div>
        </>
      ) : null}
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
