"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/src/components/ui/button";

type CopyState =
  | "copied"
  | "copy_error"
  | "copying"
  | "load_error"
  | "loading"
  | "ready";

interface ReferralLinkState {
  identityKey: string;
  signupUrl: string | null;
  status: CopyState;
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
  const state = storedState.identityKey === props.identityKey
    ? storedState
    : createReferralLinkState(props.identityKey, props.signupUrl);

  useEffect(() => {
    const identityKey = props.identityKey;
    const generation = ++requestGeneration.current;
    if (props.signupUrl) {
      setStoredState(createReferralLinkState(identityKey, props.signupUrl));
      return;
    }

    setStoredState({
      identityKey,
      signupUrl: null,
      status: "loading",
    });
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
          identityKey,
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
          identityKey,
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
    if (!state.signupUrl) {
      const generation = ++requestGeneration.current;
      setStoredState({
        identityKey,
        signupUrl: null,
        status: "loading",
      });
      try {
        const signupUrl = await loadHostedSettingsSignupReferralLink();
        if (generation !== requestGeneration.current) {
          return;
        }
        setStoredState({
          identityKey,
          signupUrl,
          status: "ready",
        });
      } catch {
        if (generation !== requestGeneration.current) {
          return;
        }
        setStoredState({
          identityKey,
          signupUrl: null,
          status: "load_error",
        });
      }
      return;
    }

    const generation = requestGeneration.current;
    const signupUrl = state.signupUrl;
    setStoredState({
      identityKey,
      signupUrl,
      status: "copying",
    });
    try {
      await navigator.clipboard.writeText(signupUrl);
      if (generation === requestGeneration.current) {
        setStoredState({
          identityKey,
          signupUrl,
          status: "copied",
        });
      }
    } catch {
      if (generation === requestGeneration.current) {
        setStoredState({
          identityKey,
          signupUrl,
          status: "copy_error",
        });
      }
    }
  }

  const label =
    state.status === "loading"
      ? "Loading..."
      : state.status === "copying"
        ? "Copying..."
        : state.status === "copied"
          ? "Copied"
          : state.status === "load_error"
            ? "Reload link"
            : state.status === "copy_error"
              ? "Try copy again"
              : "Copy link";

  return (
    <>
      <Button
        aria-label={
          state.status === "load_error"
            ? "Reload your Murph referral link"
            : "Copy your Murph referral link"
        }
        className="h-auto px-0"
        disabled={state.status === "loading" || state.status === "copying"}
        onClick={handleAction}
        size="sm"
        type="button"
        variant="link"
      >
        {label}
      </Button>
      <span aria-live="polite" className="sr-only">
        {state.status === "copied"
          ? "Referral link copied."
          : state.status === "load_error"
            ? "Could not load the referral link."
            : state.status === "copy_error"
              ? "Could not copy the referral link."
              : state.status === "ready"
                ? "Referral link ready to copy."
                : ""}
      </span>
    </>
  );
}

function createReferralLinkState(
  identityKey: string,
  signupUrl?: string | null,
): ReferralLinkState {
  return {
    identityKey,
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
