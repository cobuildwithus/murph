"use client";

import { useState } from "react";

import { Button } from "@/src/components/ui/button";

/** Copy the shareable invite URL. App opening belongs to the primary link. */
export function CopyInviteLink() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <p className="text-center text-sm leading-6 text-muted-foreground">
      <Button className="h-auto px-0" onClick={copy} size="unstyled" variant="link">
        {copied ? "Copied" : "Copy link"}
      </Button>
    </p>
  );
}
