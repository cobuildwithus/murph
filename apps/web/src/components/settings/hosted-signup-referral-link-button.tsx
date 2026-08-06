"use client";

import { useEffect, useState } from "react";

import { Button } from "@/src/components/ui/button";

type CopyState =
  | "copying"
  | "error"
  | "idle"
  | "loading"
  | "success";

let inFlightReferralLinkPromise: Promise<string> | null = null;

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

    let active = true;
    void readHostedSettingsSignupReferralLink()
      .then((url) => {
        if (!active) {
          return;
        }
        setSignupUrl(url);
        setState("idle");
      })
      .catch(() => {
        if (active) {
          setState("error");
        }
      });
    return () => {
      active = false;
    };
  }, [props.signupUrl]);

  async function copyReferralLink() {
    if (state === "loading" || state === "copying") {
      return;
    }
    if (!signupUrl) {
      setState("loading");
      try {
        const url = await readHostedSettingsSignupReferralLink();
        setSignupUrl(url);
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

function readHostedSettingsSignupReferralLink(): Promise<string> {
  if (!inFlightReferralLinkPromise) {
    inFlightReferralLinkPromise = fetch(
      "/api/settings/signup-referral-link",
      {
        cache: "no-store",
        method: "GET",
      },
    )
      .then(async (response) => {
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
      })
      .finally(() => {
        inFlightReferralLinkPromise = null;
      });
  }
  return inFlightReferralLinkPromise;
}
