"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";

export type HostedSignupReferralLinkButtonState =
  | "copied"
  | "copy_error"
  | "copying"
  | "load_error"
  | "loading"
  | "ready";

interface ReferralLinkState {
  announcement: string;
  identityKey: string;
  inputSignupUrl: string | null;
  signupUrl: string | null;
  status: HostedSignupReferralLinkButtonState;
}

export function HostedSignupReferralLinkButton(props: {
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
    void loadHostedSettingsSignupReferralLink(controller.signal)
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
        const signupUrl = await loadHostedSettingsSignupReferralLink();
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
    <HostedSignupReferralLinkButtonView
      announcement={state.announcement}
      onAction={handleAction}
      signupUrl={state.signupUrl}
      status={state.status}
    />
  );
}

export function HostedSignupReferralLinkButtonView(props: {
  announcement?: string;
  onAction: () => void;
  signupUrl?: string | null;
  status: HostedSignupReferralLinkButtonState;
}) {
  const label = readHostedSignupReferralLinkButtonLabel(props.status);
  const busy = props.status === "loading" || props.status === "copying";
  const manualCopyDescriptionId = useId();
  const showManualCopy = props.status === "copy_error" && props.signupUrl;

  return (
    <div className="flex max-w-[min(20rem,58vw)] flex-col items-end">
      <Button
        aria-busy={busy ? "true" : undefined}
        aria-label={`${label} — your Murph referral link`}
        className="h-auto px-0 aria-busy:cursor-wait"
        onClick={props.onAction}
        size="sm"
        type="button"
        variant="link"
      >
        {label}
      </Button>
      {showManualCopy ? (
        <div className="mt-2 w-full space-y-1.5 text-left">
          <p
            className="text-xs leading-relaxed text-muted-foreground"
            id={manualCopyDescriptionId}
          >
            Automatic copying was blocked. Select the link to copy it manually.
          </p>
          <Input
            aria-describedby={manualCopyDescriptionId}
            aria-label="Referral link for manual copy"
            className="h-9 bg-background font-mono md:text-xs"
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

function readHostedSignupReferralLinkButtonLabel(
  status: HostedSignupReferralLinkButtonState,
): string {
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
  status: HostedSignupReferralLinkButtonState,
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

async function loadHostedSettingsSignupReferralLink(
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
