"use client";

import { useEffect, useState } from "react";

import { Button } from "@/src/components/ui/button";

type CopyState =
  | "copying"
  | "error"
  | "idle"
  | "loading"
  | "success";

export function HostedSignupReferralLinkButton(props: {
  signupUrl?: string | null;
}) {
  const [signupUrl, setSignupUrl] = useState(props.signupUrl ?? null);
  const [state, setState] = useState<CopyState>(
    props.signupUrl ? "idle" : "loading",
  );

  useEffect(() => {
    if (props.signupUrl) {
      setSignupUrl(props.signupUrl);
      setState("idle");
      return;
    }

    const controller = new AbortController();
    void loadReferralLink(controller.signal);
    return () => controller.abort();

    async function loadReferralLink(signal: AbortSignal) {
      setState("loading");
      try {
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
        setSignupUrl(payload.signupUrl);
        setState("idle");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setState("error");
      }
    }
  }, [props.signupUrl]);

  async function copyReferralLink() {
    if (state === "loading" || state === "copying") {
      return;
    }
    if (!signupUrl) {
      setState("loading");
      try {
        const response = await fetch("/api/settings/signup-referral-link", {
          cache: "no-store",
          method: "GET",
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
        setSignupUrl(payload.signupUrl);
        setState("idle");
      } catch {
        setState("error");
      }
      return;
    }

    setState("copying");
    try {
      await navigator.clipboard.writeText(signupUrl);
      setState("success");
    } catch {
      setState("error");
    }
  }

  const label =
    state === "loading"
      ? "Loading..."
      : state === "copying"
        ? "Copying..."
        : state === "success"
          ? "Copied"
          : state === "error"
            ? "Try again"
            : "Copy link";

  return (
    <>
      <Button
        aria-label="Copy your Murph referral link"
        className="h-auto px-0"
        disabled={state === "loading" || state === "copying"}
        onClick={copyReferralLink}
        size="sm"
        type="button"
        variant="link"
      >
        {label}
      </Button>
      <span aria-live="polite" className="sr-only">
        {state === "success"
          ? "Referral link copied."
          : state === "error"
            ? "Could not load or copy the referral link."
            : ""}
      </span>
    </>
  );
}
