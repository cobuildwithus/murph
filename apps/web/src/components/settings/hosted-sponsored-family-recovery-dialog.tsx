"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useRef, useState } from "react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/src/components/ui/dialog";

const FAMILY_SETTINGS_PATH = "/settings#family";

type ClipboardFeedback =
  | { kind: "idle" }
  | { kind: "success"; url: string }
  | { kind: "failure"; url: string };

export function HostedSponsoredFamilyRecoveryDialog(props: {
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(props.initialOpen === true);
  const [feedback, setFeedback] = useState<ClipboardFeedback>({ kind: "idle" });
  const titleRef = useRef<HTMLHeadingElement>(null);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setFeedback({ kind: "idle" });
    }
  }

  async function copyFamilySettingsLink() {
    const url = new URL(FAMILY_SETTINGS_PATH, window.location.origin).toString();
    const clipboard = navigator.clipboard;
    try {
      if (!clipboard?.writeText) {
        throw new TypeError("Clipboard unavailable");
      }
      await clipboard.writeText(url);
      setFeedback({ kind: "success", url });
    } catch {
      setFeedback({ kind: "failure", url });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={(
          <Button
            className="min-h-11 w-full sm:w-auto"
            size="lg"
            type="button"
            variant="outline"
          />
        )}
      >
        Ask your Family owner
      </DialogTrigger>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] max-w-md gap-6 overflow-y-auto border border-border bg-popover p-6 sm:p-8"
        initialFocus={titleRef}
      >
        <DialogHeader className="pr-10">
          <DialogTitle
            ref={titleRef}
            tabIndex={-1}
            className="font-serif text-2xl font-semibold tracking-tight outline-none"
          >
            Your Family owner controls the plan
          </DialogTitle>
          <DialogDescription className="text-sm leading-6 text-muted-foreground">
            Send them this Family Settings link. After they sign in, they can
            choose your account and review the available plan options.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Button
            className="min-h-14 w-full whitespace-normal px-5 text-center"
            onClick={() => void copyFamilySettingsLink()}
            size="xl"
            type="button"
          >
            {feedback.kind === "success" ? (
              <CheckIcon aria-hidden="true" data-icon="inline-start" />
            ) : (
              <CopyIcon aria-hidden="true" data-icon="inline-start" />
            )}
            {feedback.kind === "success"
              ? "Family Settings link copied"
              : "Copy link for your Family owner"}
          </Button>

          {feedback.kind === "success" ? (
            <p
              aria-live="polite"
              className="text-sm leading-6 text-muted-foreground"
              role="status"
            >
              Link copied. Send it to your Family owner.
            </p>
          ) : feedback.kind === "failure" ? (
            <Alert
              aria-live="assertive"
              variant="destructive"
            >
              <AlertTitle>
                The link could not be copied.
              </AlertTitle>
              <AlertDescription>
                <p>Copy this generic Family Settings URL manually:</p>
                <p className="mt-2 break-all rounded-lg bg-background px-3 py-2 font-mono text-xs text-foreground">
                  {feedback.url}
                </p>
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
