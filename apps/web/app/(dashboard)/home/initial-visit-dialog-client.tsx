"use client";

import { useEffect, useState } from "react";
import { MessageCircleIcon } from "lucide-react";

import { MurphContactCardPicker } from "@/src/components/murph/murph-contact-card-picker";
import { MurphContactLink } from "@/src/components/murph/murph-contact-link";
import { Button, buttonVariants } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

const INITIAL_VISIT_QUERY_KEY = "initialVisit";

export type HomeInitialVisitContactAction = Pick<
  MurphContactOption,
  "href" | "kind" | "label" | "rel" | "target"
>;

export function HomeInitialVisitDialogClient({
  contactAction,
}: {
  contactAction: HomeInitialVisitContactAction | null;
}) {
  // Members on a text line meet the add-to-contacts step first; everyone
  // else (Telegram or email only, or no channel yet) goes straight to the
  // welcome dialog since there is no phone contact card to save.
  const [stage, setStage] = useState<"contact" | "welcome">(
    contactAction?.kind === "text" ? "contact" : "welcome",
  );
  const [open, setOpen] = useState(true);

  useEffect(() => {
    stripInitialVisitQueryParam();
  }, []);

  if (stage === "contact") {
    return (
      <MurphContactCardPicker
        onAddToContacts={() => setStage("welcome")}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setStage("welcome");
          }
        }}
        onSkip={() => setStage("welcome")}
        open
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="max-w-md gap-6 rounded-2xl border border-border bg-popover p-6 text-popover-foreground ring-border md:p-7"
      >
        <DialogHeader className="items-center gap-4 text-center">
          <span
            aria-hidden="true"
            className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary"
          >
            <MurphLogoMark className="h-9 w-auto" />
          </span>
          <div className="flex flex-col gap-2">
            <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-foreground">
              Welcome to Murph
            </DialogTitle>
            <DialogDescription className="text-sm leading-6 text-muted-foreground">
              Your personal health assistant is here. Message Murph to get
              started.
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {contactAction ? (
            <MurphContactLink
              actionLabel="Text Murph"
              className={buttonVariants({
                className: "w-full",
                size: "xl",
              })}
              option={contactAction}
              onClick={() => setOpen(false)}
            >
              <MessageCircleIcon data-icon="inline-start" />
              Text Murph
            </MurphContactLink>
          ) : (
            <a
              aria-label="Set up a Murph contact channel"
              className={buttonVariants({
                className: "w-full",
                size: "xl",
              })}
              href="/settings"
              onClick={() => setOpen(false)}
            >
              <MessageCircleIcon data-icon="inline-start" />
              Text Murph
            </a>
          )}
          <Button
            type="button"
            className="w-full"
            size="xl"
            variant="ghost"
            onClick={() => setOpen(false)}
          >
            Start exploring
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function stripInitialVisitQueryParam() {
  if (typeof window === "undefined" || typeof window.location.href !== "string") {
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.delete(INITIAL_VISIT_QUERY_KEY);
  window.history?.replaceState?.({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function MurphLogoMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      data-home-initial-visit-logo="murph"
      fill="none"
      viewBox="0 0 65 44"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="6.5" cy="5.5" fill="#b5c4a1" fillOpacity=".3" r="2" />
      <circle cx="16.5" cy="5.5" fill="#b5c4a1" fillOpacity=".3" r="2" />
      <circle cx="27" cy="5.5" fill="#c4956a" fillOpacity=".55" r="2.5" />
      <circle cx="38" cy="5.5" fill="#c4956a" fillOpacity=".55" r="2.5" />
      <circle cx="48.5" cy="5.5" fill="#b5c4a1" fillOpacity=".3" r="2" />
      <circle cx="58.5" cy="5.5" fill="#b5c4a1" fillOpacity=".3" r="2" />
      <circle cx="4.5" cy="15.5" fill="#b5c4a1" fillOpacity=".3" r="2" />
      <circle cx="14.5" cy="15.5" fill="#b5c4a1" fillOpacity=".3" r="2" />
      <circle cx="26" cy="15.5" fill="#a07a4e" r="3.5" />
      <circle cx="39" cy="15.5" fill="#a07a4e" r="3.5" />
      <circle cx="50.5" cy="15.5" fill="#b5c4a1" fillOpacity=".3" r="2" />
      <circle cx="60.5" cy="15.5" fill="#b5c4a1" fillOpacity=".3" r="2" />
      <circle cx="2" cy="27.5" fill="#b5c4a1" fillOpacity=".3" r="2" />
      <circle cx="12.5" cy="27.5" fill="#c4956a" fillOpacity=".55" r="2.5" />
      <circle cx="25" cy="27.5" fill="#8b6840" r="4" />
      <circle cx="39.5" cy="27.5" fill="#8b6840" r="4.5" />
      <circle cx="52.5" cy="27.5" fill="#c4956a" fillOpacity=".55" r="2.5" />
      <circle cx="63" cy="27.5" fill="#b5c4a1" fillOpacity=".3" r="2" />
      <circle cx="6.5" cy="38.5" fill="#b5c4a1" fillOpacity=".3" r="2" />
      <circle cx="16.5" cy="38.5" fill="#b5c4a1" fillOpacity=".3" r="2" />
      <circle cx="27" cy="38.5" fill="#c4956a" fillOpacity=".55" r="2.5" />
      <circle cx="38" cy="38.5" fill="#c4956a" fillOpacity=".55" r="2.5" />
      <circle cx="48.5" cy="38.5" fill="#b5c4a1" fillOpacity=".3" r="2" />
      <circle cx="58.5" cy="38.5" fill="#b5c4a1" fillOpacity=".3" r="2" />
    </svg>
  );
}
