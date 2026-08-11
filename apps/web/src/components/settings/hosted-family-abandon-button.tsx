"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import {
  Alert,
  AlertDescription,
} from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";

import { toErrorMessage } from "./hosted-settings-sync-helpers";

export function HostedFamilyAbandonButton(props: {
  returnPath?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function abandonDraft() {
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      await requestHostedOnboardingJson<{ abandoned: boolean }>({
        method: "DELETE",
        url: "/api/settings/billing/family/draft",
      });
      if (props.returnPath) {
        router.replace(props.returnPath);
      } else {
        setOpen(false);
        setIsSubmitting(false);
        router.refresh();
      }
    } catch (error) {
      setIsSubmitting(false);
      setErrorMessage(toErrorMessage(
        error,
        "Could not abandon the unfinished Family setup right now.",
      ));
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        onClick={() => setOpen(true)}
        disabled={isSubmitting}
        className="w-full"
      >
        Abandon Family setup
      </Button>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!isSubmitting) {
            setOpen(nextOpen);
          }
        }}
      >
        <DialogContent className="max-w-md gap-6 p-6 md:p-7">
          <DialogHeader className="pr-10">
            <DialogTitle>Abandon your unfinished Family setup?</DialogTitle>
            <DialogDescription>
              This expires any open checkout and removes only the unpaid Family
              setup you own. It does not cancel an active paid Family plan. You
              can then join someone else&apos;s Family using their invite.
            </DialogDescription>
          </DialogHeader>
          {errorMessage ? (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter className="flex-col sm:flex-col">
            <Button
              type="button"
              size="xl"
              variant="destructive"
              onClick={() => void abandonDraft()}
              disabled={isSubmitting}
              className="w-full"
            >
              {isSubmitting ? "Abandoning setup..." : "Abandon unpaid setup"}
            </Button>
            <Button
              type="button"
              size="xl"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={isSubmitting}
              className="w-full"
            >
              Keep my setup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
