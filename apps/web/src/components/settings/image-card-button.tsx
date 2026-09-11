"use client";

import { useState } from "react";
import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { Button } from "@/src/components/ui/button";
import { toErrorMessage } from "./hosted-settings-sync-helpers";

export function ImageCardButton({ available }: { available: boolean }) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function open() {
    setOpening(true);
    setError(null);
    try {
      const result = await requestHostedOnboardingJson<{ url: string }>({
        method: "POST", url: "/api/settings/billing/image-card",
      });
      window.location.assign(result.url);
    } catch (cause) {
      setError(toErrorMessage(cause, "Could not open card setup. Please try again."));
      setOpening(false);
    }
  }
  if (!available) return null;
  return <div className="flex flex-col gap-2 rounded-xl border p-4">
    <p className="text-sm text-pretty text-muted-foreground">
      Image generation on Starter requires a saved card. Adding a card does not charge you or start a subscription.
    </p>
    <Button variant="secondary" className="self-start" disabled={opening} onClick={() => void open()}>
      {opening ? "Opening Stripe..." : "Add or update card"}
    </Button>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </div>;
}
