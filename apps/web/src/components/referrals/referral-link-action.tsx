"use client";

import { Check, Copy, LoaderCircle } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";

export type ReferralLinkActionState =
  | "copied"
  | "copy_error"
  | "copying"
  | "load_error"
  | "loading"
  | "ready";

export type ReferralLinkActionAppearance = "marketing" | "settings";

interface ReferralLinkState {
  announcement: string;
  identityKey: string;
  inputSignupUrl: string | null;
  signupUrl: string | null;
  status: ReferralLinkActionState;
}

export function ReferralLinkAction(props: {
  appearance?: ReferralLinkActionAppearance;
  identityKey: string;
  signupUrl?: string | null;
}) {
  const requestGeneration = useRef(0);
  const [storedState, setStoredState] = useState<ReferralLinkState>(() =>
    createReferralLinkState(props.identityKey, props.signupUrl)
  );
  // Effects run after paint. Deriving a safe identity-scoped view here prevents
  // the prior account's ready URL from surviving even one transition frame.
  const inputSignupUrl = props.signupUrl ?? null;
  const state = storedState.identityKey === props.identityKey
    && storedState.inputSignupUrl === inputSignupUrl
    ? storedState
    : createReferralLinkState(props.identityKey, props.signupUrl);

  useEffect(() => {
    const identityKey = props.identityKey;
    const generation = ++requestGeneration.current;
    if (props.signupUrl) {
      return;
    }

    const controller = new AbortController();
    void loadHostedSignupReferralLink(controller.signal)
      .then((signupUrl) => {
        if (
          controller.signal.aborted
          || generation !== requestGeneration.current
        ) {
          return;
        }
        setStoredState({
          announcement: "",
          identityKey,
          inputSignupUrl: null,
          signupUrl,
          status: "ready",
        });
      })
      .catch(() => {
        if (
          controller.signal.aborted
          || generation !== requestGeneration.current
        ) {
          return;
        }
        setStoredState({
          announcement: "Could not load the referral link.",
          identityKey,
          inputSignupUrl: null,
          signupUrl: null,
          status: "load_error",
        });
      });
    return () => controller.abort();
  }, [props.identityKey, props.signupUrl]);

  async function handleAction() {
    if (state.status === "loading" || state.status === "copying") {
      return;
    }

    const identityKey = props.identityKey;
    const currentInputSignupUrl = props.signupUrl ?? null;
    if (!state.signupUrl) {
      const generation = ++requestGeneration.current;
      setStoredState({
        announcement: "",
        identityKey,
        inputSignupUrl: currentInputSignupUrl,
        signupUrl: null,
        status: "loading",
      });
      try {
        const signupUrl = await loadHostedSignupReferralLink();
        if (generation !== requestGeneration.current) {
          return;
        }
        setStoredState({
          announcement: "Referral link ready to copy.",
          identityKey,
          inputSignupUrl: currentInputSignupUrl,
          signupUrl,
          status: "ready",
        });
      } catch {
        if (generation !== requestGeneration.current) {
          return;
        }
        setStoredState({
          announcement: "Could not load the referral link.",
          identityKey,
          inputSignupUrl: currentInputSignupUrl,
          signupUrl: null,
          status: "load_error",
        });
      }
      return;
    }

    const generation = requestGeneration.current;
    const signupUrl = state.signupUrl;
    setStoredState({
      announcement: "",
      identityKey,
      inputSignupUrl: currentInputSignupUrl,
      signupUrl,
      status: "copying",
    });
    try {
      await navigator.clipboard.writeText(signupUrl);
      if (generation === requestGeneration.current) {
        setStoredState({
          announcement: "Referral link copied.",
          identityKey,
          inputSignupUrl: currentInputSignupUrl,
          signupUrl,
          status: "copied",
        });
      }
    } catch {
      if (generation === requestGeneration.current) {
        setStoredState({
          announcement: readDefaultAnnouncement("copy_error"),
          identityKey,
          inputSignupUrl: currentInputSignupUrl,
          signupUrl,
          status: "copy_error",
        });
      }
    }
  }

  return (
    <ReferralLinkActionView
      announcement={state.announcement}
      appearance={props.appearance}
      onAction={handleAction}
      signupUrl={state.signupUrl}
      status={state.status}
    />
  );
}

export function ReferralLinkActionView(props: {
  announcement?: string;
  appearance?: ReferralLinkActionAppearance;
  onAction: () => void;
  signupUrl?: string | null;
  status: ReferralLinkActionState;
}) {
  const appearance = props.appearance ?? "settings";
  const marketing = appearance === "marketing";
  const label = readReferralLinkActionLabel(props.status, appearance);
  const busy = props.status === "loading" || props.status === "copying";
  const manualCopyDescriptionId = useId();
  const showManualCopy = props.status === "copy_error" && props.signupUrl;

  return (
    <div
      className={marketing
        ? "flex w-full max-w-[29rem] flex-col items-start"
        : "flex max-w-[min(20rem,58vw)] flex-col items-end"}
    >
      <Button
        aria-busy={busy ? "true" : undefined}
        aria-label={`${label}, your Murph referral link`}
        className={marketing
          ? "min-h-12 gap-2 rounded-xl border border-white/10 bg-[#f5f0e8] px-5 py-3.5 text-[0.9375rem] font-semibold text-[#2d3436] transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4b87a] aria-busy:cursor-wait"
          : "h-auto px-0 aria-busy:cursor-wait"}
        onClick={props.onAction}
        size={marketing ? "unstyled" : "sm"}
        type="button"
        variant={marketing ? "unstyled" : "link"}
      >
        {marketing ? <ReferralLinkActionIcon status={props.status} /> : null}
        {label}
      </Button>
      {showManualCopy ? (
        <div className={marketing
          ? "mt-3 w-full space-y-2 text-left"
          : "mt-2 w-full space-y-1.5 text-left"}
        >
          <p
            className={marketing
              ? "text-xs leading-relaxed text-[#f5f0e8]/70"
              : "text-xs leading-relaxed text-muted-foreground"}
            id={manualCopyDescriptionId}
          >
            Automatic copying was blocked. Select the link to copy it manually.
          </p>
          <Input
            aria-describedby={manualCopyDescriptionId}
            aria-label="Referral link for manual copy"
            className={marketing
              ? "h-10 border-white/20 bg-white/10 font-mono text-xs text-white selection:bg-white/20 md:text-xs"
              : "h-9 bg-background font-mono md:text-xs"}
            onClick={(event) => event.currentTarget.select()}
            onFocus={(event) => event.currentTarget.select()}
            readOnly
            spellCheck={false}
            value={props.signupUrl ?? ""}
          />
        </div>
      ) : null}
      <span aria-live="polite" className="sr-only">
        {props.announcement ?? readDefaultAnnouncement(props.status)}
      </span>
    </div>
  );
}

function ReferralLinkActionIcon({
  status,
}: {
  status: ReferralLinkActionState;
}) {
  return status === "loading" || status === "copying" ? (
    <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
  ) : status === "copied" ? (
    <Check aria-hidden="true" className="size-4" />
  ) : (
    <Copy aria-hidden="true" className="size-4" />
  );
}

function readReferralLinkActionLabel(
  status: ReferralLinkActionState,
  appearance: ReferralLinkActionAppearance,
): string {
  if (appearance === "marketing") {
    return status === "loading"
      ? "Loading your link..."
      : status === "copying"
        ? "Copying..."
        : status === "copied"
          ? "Copied your link"
          : status === "load_error"
            ? "Reload referral link"
            : status === "copy_error"
              ? "Try copy again"
              : "Copy referral link";
  }

  return status === "loading"
    ? "Loading..."
    : status === "copying"
      ? "Copying..."
      : status === "copied"
        ? "Copied"
        : status === "load_error"
          ? "Reload link"
          : status === "copy_error"
            ? "Try copy again"
            : "Copy link";
}

function readDefaultAnnouncement(
  status: ReferralLinkActionState,
): string {
  return status === "copied"
    ? "Referral link copied."
    : status === "load_error"
      ? "Could not load the referral link."
      : status === "copy_error"
        ? "Could not copy the referral link. Select the link field below to copy it manually."
        : "";
}

function createReferralLinkState(
  identityKey: string,
  signupUrl?: string | null,
): ReferralLinkState {
  return {
    announcement: "",
    identityKey,
    inputSignupUrl: signupUrl ?? null,
    signupUrl: signupUrl ?? null,
    status: signupUrl ? "ready" : "loading",
  };
}

async function loadHostedSignupReferralLink(
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch("/api/settings/signup-referral-link", {
    cache: "no-store",
    method: "GET",
    signal,
  });
  if (!response.ok) {
    throw new Error("Referral link unavailable");
  }
  const payload = await response.json() as {
    signupUrl?: unknown;
  };
  if (
    typeof payload.signupUrl !== "string"
    || payload.signupUrl.length === 0
  ) {
    throw new Error("Referral link missing");
  }
  return payload.signupUrl;
}
