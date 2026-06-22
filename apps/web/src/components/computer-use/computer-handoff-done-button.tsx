"use client";

import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import { useState, useTransition } from "react";

import { Button, buttonVariants } from "@/src/components/ui/button";
import { cn } from "@/src/lib/utils";

interface ComputerHandoffDoneButtonProps {
  endpoint: string;
}

export function ComputerHandoffDoneButton({
  endpoint,
}: ComputerHandoffDoneButtonProps) {
  const [pending, startTransition] = useTransition();
  const [redirectTo, setRedirectTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    startTransition(async () => {
      setError(null);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          setError("Could not complete. Try again.");
          return;
        }
        const data = (await response.json()) as { redirectTo?: unknown };
        if (typeof data.redirectTo !== "string" || data.redirectTo.length === 0) {
          setError("Could not complete. Try again.");
          return;
        }
        setRedirectTo(data.redirectTo);
        window.location.href = data.redirectTo;
      } catch {
        setError("Could not complete. Try again.");
      }
    });
  };

  if (redirectTo) {
    return (
      <a
        href={redirectTo}
        className={cn(buttonVariants({ size: "lg" }))}
        aria-label="Open Murph to send your reply"
      >
        <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        Open Murph
      </a>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
      <Button
        type="button"
        size="lg"
        onClick={onClick}
        disabled={pending}
        aria-label="Finish browser step and reply to Murph"
      >
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        {pending ? "Saving…" : "Done"}
      </Button>
    </div>
  );
}
