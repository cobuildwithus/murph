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

export function HostedSignupReferralLinkButton(props: {
  identityKey: string;
  signupUrl?: string | null;
}) {
  const requestGeneration = useRef(0);
  const [signupUrl, setSignupUrl] = useState(props.signupUrl ?? null);
  const [state, setState] = useState<CopyState>(
    props.signupUrl ? "ready" : "loading",
  );

  useEffect(() => {
    const generation = ++requestGeneration.current;
    if (props.signupUrl) {
      setSignupUrl(props.signupUrl);
      setState("ready");
      return;
    }

    setSignupUrl(null);
    setState("loading");
    const controller = new AbortController();
    void loadHostedSettingsSignupReferralLink(controller.signal)
      .then((url) => {
        if (
          controller.signal.aborted
          || generation !== requestGeneration.current
        ) {
          return;
        }
        setSignupUrl(url);
        setState("ready");
      })
      .catch(() => {
        if (
          controller.signal.aborted
          || generation !== requestGeneration.current
        ) {
          return;
        }
        setSignupUrl(null);
        setState("load_error");
      });
    return () => controller.abort();
  }, [props.identityKey, props.signupUrl]);

  async function handleAction() {
    if (state === "loading" || state === "copying") {
      return;
    }

    if (!signupUrl) {
      const generation = ++requestGeneration.current;
      setSignupUrl(null);
      setState("loading");
      try {
        const url = await loadHostedSettingsSignupReferralLink();
        if (generation !== requestGeneration.current) {
          return;
        }
        setSignupUrl(url);
        setState("ready");
      } catch {
        if (generation !== requestGeneration.current) {
          return;
        }
        setSignupUrl(null);
        setState("load_error");
      }
      return;
    }

    const generation = requestGeneration.current;
    setState("copying");
    try {
      await navigator.clipboard.writeText(signupUrl);
      if (generation === requestGeneration.current) {
        setState("copied");
      }
    } catch {
      if (generation === requestGeneration.current) {
        setState("copy_error");
      }
    }
  }

  const label =
    state === "loading"
      ? "Loading..."
      : state === "copying"
        ? "Copying..."
        : state === "copied"
          ? "Copied"
          : state === "load_error"
            ? "Reload link"
            : state === "copy_error"
              ? "Try copy again"
              : "Copy link";

  return (
    <>
      <Button
        aria-label={
          state === "load_error"
            ? "Reload your Murph referral link"
            : "Copy your Murph referral link"
        }
        className="h-auto px-0"
        disabled={state === "loading" || state === "copying"}
        onClick={handleAction}
        size="sm"
        type="button"
        variant="link"
      >
        {label}
      </Button>
      <span aria-live="polite" className="sr-only">
        {state === "copied"
          ? "Referral link copied."
          : state === "load_error"
            ? "Could not load the referral link."
            : state === "copy_error"
              ? "Could not copy the referral link."
              : state === "ready"
                ? "Referral link ready to copy."
                : ""}
      </span>
    </>
  );
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
