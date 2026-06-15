"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircleIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";

import { requestHostedAutoPulseTrialEnrollment } from "./client-api";

export function JoinInviteAutoTrialIsland({
  inviteCode,
}: {
  inviteCode: string;
}) {
  const { replace } = useRouter();
  const startedRef = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const startTrial = useCallback(async () => {
    if (startedRef.current) {
      return;
    }

    startedRef.current = true;
    setErrorMessage(null);

    try {
      const enrollment = await requestHostedAutoPulseTrialEnrollment({
        inviteCode,
      });
      replace(enrollment.redirectPath);
    } catch (error) {
      startedRef.current = false;
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, [inviteCode, replace]);

  useEffect(() => {
    let canceled = false;
    queueMicrotask(() => {
      if (!canceled) {
        void startTrial();
      }
    });

    return () => {
      canceled = true;
    };
  }, [startTrial]);

  if (errorMessage) {
    return (
      <div className="w-full rounded-2xl border border-border bg-card/80 p-6">
        <div className="space-y-4">
          <div>
            <p className="font-serif text-xl font-normal text-foreground">
              Trial setup paused
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              We could not start your Pulse trial.
            </p>
          </div>

          <Alert variant="destructive">
            <AlertTitle>Unable to start your trial</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>

          <Button
            type="button"
            onClick={() => void startTrial()}
            variant="outline"
            size="lg"
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      role="status"
      className="w-full rounded-2xl border border-border bg-card/80 p-6"
    >
      <div className="flex items-start gap-3">
        <LoaderCircleIcon
          aria-hidden
          className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground"
        />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="font-serif text-xl font-normal text-foreground">
              Setting up your trial
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              We are starting your 7-day Pulse trial. No card required.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
