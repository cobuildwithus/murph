"use client";

import { useEffect, useState } from "react";

import { Button } from "@/src/components/ui/button";

type CopyState =
  | "copied"
  | "copy_error"
  | "copying"
  | "load_error"
  | "loading"
  | "ready";

export function HostedSignupReferralLinkButton(props: {
  signupUrl?: string | null;
}) {
  const [signupUrl, setSignupUrl] = useState(props.signupUrl ?? null);
  const [state, setState] = useState<CopyState>(
    props.signupUrl ? "ready" : "loading",
  );

  useEffect(() => {
    if (props.signupUrl) {
      setSignupUrl(props.signupUrl);
      setState("ready");
      return;
    }

    const controller = new AbortController();
    void loadHostedSettingsSignupReferralLink(controller.signal)
      .then((url) => {
        setSignupUrl(url);
        setState("ready");
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setState("load_error");
        }
      });
    return () => controller.abort();
  }, [props.signupUrl]);

  async function handleAction() {
    if (state === "loading" || state === "copying") {
      return;
    }

    if (!signupUrl) {
      setState("loading");
      try {
        const url = await loadHostedSettingsSignupReferralLink();
        setSignupUrl(url);
        setState("ready");
      } catch {
        setState("load_error");
      }
      return;
    }

    setState("copying");
    try {
      await navigator.clipboard.writeText(signupUrl);
      setState("copied");
    } catch {
      setState("copy_error");
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
