"use client";

import { useState } from "react";

import { Button } from "@/src/components/ui/button";

type CopyState = "copying" | "error" | "idle" | "success";

export function HostedSignupReferralLinkButton(props: {
  signupUrl: string;
}) {
  const [state, setState] = useState<CopyState>("idle");

  async function copyReferralLink() {
    if (state === "copying") {
      return;
    }
    setState("copying");
    try {
      await navigator.clipboard.writeText(props.signupUrl);
      setState("success");
    } catch {
      setState("error");
    }
  }

  const label =
    state === "copying"
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
        disabled={state === "copying"}
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
            ? "Could not copy the referral link."
            : ""}
      </span>
    </>
  );
}
