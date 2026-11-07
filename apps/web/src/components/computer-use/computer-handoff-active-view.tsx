"use client";

import { track } from "@vercel/analytics";
import { Keyboard, MessageCircle } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";

import { ComputerHandoffFloatingIsland } from "@/src/components/computer-use/computer-handoff-floating-island";
import {
  ComputerHandoffBrowserObject,
  ComputerHandoffSavingScreen,
} from "@/src/components/computer-use/computer-handoff-screens";
import {
  LINK_PAGE_PILL_CLASS,
  LinkPagePill,
  LinkPageScreen,
  LinkPageSurface,
} from "@/src/components/link-page/link-page-shell";
import { Button } from "@/src/components/ui/button";

type Phase =
  | { kind: "idle"; error: string | null }
  | { kind: "saving" }
  | { kind: "done"; redirectTo: string };

const HANDOFF_COVER_CLASS =
  "fixed inset-0 z-20 flex flex-col overflow-y-auto bg-[#1C1915] text-[#FFFCF6]";

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
              aria-label="Your turn"
              aria-modal="true"
              className={HANDOFF_COVER_CLASS}
              role="dialog"
            >
              <LinkPageSurface>
                <ComputerHandoffTakeoverScreen onTakeOver={onTakeOver} />
              </LinkPageSurface>
            </div>
          ) : null}
          {takeoverStarted ? (
            <div
              className="pointer-events-none fixed inset-x-0 bottom-0 z-10 flex justify-center px-4 pb-4"
              style={{
                paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)",
              }}
            >
              <ComputerHandoffIsland
                controlsDisabled={controlsDisabled}
                error={idleError}
                onDone={onDone}
                onFocus={focusLiveView}
              />
            </div>
          ) : null}
        </>
      ) : null}
      {phase.kind === "saving" ? (
        <div aria-busy aria-live="polite" className={HANDOFF_COVER_CLASS} role="status">
          <LinkPageSurface>
            <ComputerHandoffSavingScreen announceDetail={false} />
          </LinkPageSurface>
        </div>
      ) : null}
      {phase.kind === "done" ? (
        <div aria-live="polite" className={HANDOFF_COVER_CLASS} role="status">
          <LinkPageSurface>
            <ComputerHandoffDoneScreen
              anchorRef={successAnchorRef}
              redirectTo={phase.redirectTo}
            />
          </LinkPageSurface>
        </div>
      ) : null}
    </>
  );
}

export function ComputerHandoffTakeoverScreen({
  onTakeOver,
}: {
  onTakeOver?: () => void;
}) {
  return (
    <LinkPageScreen
      actions={
        <LinkPagePill aria-label="Take over the private browser" onClick={onTakeOver}>
          Take over
        </LinkPagePill>
      }
      announceDetail={false}
      detail={
        <span id="computer-handoff-takeover-description">
          Take over to finish this step. Use the keyboard icon to type or paste.
        </span>
      }
      title="Your turn."
    >
      <ComputerHandoffBrowserObject />
    </LinkPageScreen>
  );
}

export function ComputerHandoffDoneScreen({
  anchorRef,
  redirectTo,
}: {
  anchorRef?: Ref<HTMLAnchorElement>;
  redirectTo: string;
}) {
  return (
    <LinkPageScreen
      actions={
        <a
          aria-label="Open Murph to send your reply"
          className={LINK_PAGE_PILL_CLASS}
          href={redirectTo}
          ref={anchorRef}
        >
          <MessageCircle aria-hidden="true" className="size-5 shrink-0" />
          {redirectTo.startsWith("sms:") ? "Open Messages" : "Open Murph"}
        </a>
      }
      announceDetail={false}
      detail="Reply to Murph to continue."
      title="All set."
    />
  );
}

export function ComputerHandoffIsland({
  controlsDisabled = false,
  error = null,
  keepInViewport,
  onDone,
  onFocus,
  persistKey,
}: {
  controlsDisabled?: boolean;
  error?: ReactNode;
  keepInViewport?: boolean;
  onDone?: () => void;
  onFocus?: () => void;
  persistKey?: string | null;
}) {
  return (
    <ComputerHandoffFloatingIsland
      keepInViewport={keepInViewport}
      handle={error ? (
        <span className="text-sm font-medium leading-5 text-[#E27B6E]" role="alert">
          {error}
        </span>
      ) : (
        <span className="text-base font-semibold leading-[22px]">Murph is waiting</span>
      )}
      persistKey={persistKey}
    >
      <Button
        aria-label="Focus the private browser"
        className="hidden size-[52px] shrink-0 rounded-full bg-[#2A2622] text-[#FFFCF6] hover:bg-[#34302B] sm:inline-flex"
        disabled={controlsDisabled}
        onClick={onFocus}
        size="unstyled"
        title="Focus browser"
        type="button"
        variant="unstyled"
      >
        <Keyboard className="h-4 w-4" aria-hidden="true" />
      </Button>
      <LinkPagePill
        aria-label="Finish this step and return to Murph"
        className="h-[52px] w-auto shrink-0 px-[26px]"
        disabled={controlsDisabled}
        onClick={onDone}
      >
        Done
      </LinkPagePill>
    </ComputerHandoffFloatingIsland>
  );
}
