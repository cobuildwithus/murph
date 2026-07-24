"use client";

import { MailIcon } from "lucide-react";

import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";

const CHANGE_EMAIL_STEPS = [
  {
    title: "Pick your address",
    detail: "Settings > Messages > Send & Receive, then choose the one you want.",
  },
  {
    title: "Text Murph again",
    detail: "Tap the new link Murph replies with.",
  },
] as const;

export function JoinInviteChangeEmailDialog({
  emailAddress,
  onOpenChange,
  open,
}: {
  emailAddress: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] max-w-[calc(100%-2rem)] gap-6 overflow-y-auto rounded-2xl border border-border bg-popover p-6 text-popover-foreground ring-border sm:max-w-md md:p-7"
      >
        <DialogHeader className="items-center gap-4 text-center">
          <span
            aria-hidden="true"
            className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary"
          >
            <MailIcon className="size-8" />
          </span>
          <div className="flex flex-col gap-2">
            <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-foreground">
              Want a different email?
            </DialogTitle>
            <DialogDescription className="text-sm leading-6 text-muted-foreground">
              Your phone texted Murph from {emailAddress}, so this link is tied
              to it. Apple sometimes texts from an iCloud email instead of your
              number.
            </DialogDescription>
          </div>
        </DialogHeader>

        <ol className="flex flex-col gap-4">
          {CHANGE_EMAIL_STEPS.map((step, index) => (
            <li key={step.title} className="flex items-start gap-3 text-left">
              <span
                aria-hidden="true"
                className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-sm font-medium text-primary"
              >
                {index + 1}
              </span>
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-medium text-foreground">{step.title}</p>
                <p className="text-sm leading-6 text-muted-foreground">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>

        <Button
          type="button"
          className="w-full"
          size="xl"
          onClick={() => onOpenChange(false)}
        >
          Got it
        </Button>
      </DialogContent>
    </Dialog>
  );
}
