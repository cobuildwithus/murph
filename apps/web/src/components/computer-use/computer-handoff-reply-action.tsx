"use client";

import { ChevronRight, ExternalLink, Mail, MessageCircle, Send } from "lucide-react";
import { useState } from "react";

import { MurphContactLink } from "@/src/components/murph/murph-contact-link";
import { Button, buttonVariants } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import type {
  MurphContactKind,
  MurphContactOption,
} from "@/src/lib/murph-contact-routing";
import { cn } from "@/src/lib/utils";

const CONTACT_OPTION_ICONS: Record<MurphContactKind, typeof MessageCircle> = {
  email: Mail,
  telegram: Send,
  text: MessageCircle,
};

const PRIMARY_LABEL = "Reply to Murph";

export function ComputerHandoffReplyAction({
  options,
}: {
  options: MurphContactOption[];
}) {
  const [open, setOpen] = useState(false);

  if (options.length === 0) {
    return null;
  }

  if (options.length === 1) {
    const option = options[0];
    return (
      <MurphContactLink
        actionLabel={PRIMARY_LABEL}
        option={option}
        className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")}
      >
        <MessageCircle className="size-4 shrink-0" aria-hidden="true" />
        {PRIMARY_LABEL}
      </MurphContactLink>
    );
  }

  return (
    <>
      <Button
        type="button"
        size="lg"
        className="w-full sm:w-auto"
        onClick={() => setOpen(true)}
        aria-label={PRIMARY_LABEL}
      >
        <MessageCircle className="size-4 shrink-0" aria-hidden="true" />
        {PRIMARY_LABEL}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md p-6 md:p-7">
          <DialogHeader className="pr-10">
            <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
              {PRIMARY_LABEL}
            </DialogTitle>
            <DialogDescription>Pick how you want to reply.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {options.map((option) => {
              const Icon = CONTACT_OPTION_ICONS[option.kind];
              const opensInNewTab = option.target === "_blank";
              const hasWebmail = Boolean(option.webmail);

              return (
                <div
                  key={option.kind}
                  className="overflow-hidden rounded-lg border border-border bg-card"
                >
                  <div className="relative flex items-center pr-3 transition-colors hover:bg-accent/55">
                    <a
                      href={option.href}
                      target={option.target}
                      rel={option.rel}
                      aria-label={`${PRIMARY_LABEL} in ${option.label}${
                        opensInNewTab ? " (opens in a new tab)" : ""
                      }`}
                      className={`flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-sm font-medium text-foreground outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring ${
                        hasWebmail
                          ? "rounded-t-lg after:rounded-t-lg"
                          : "rounded-lg after:rounded-lg"
                      }`}
                      onClick={() => setOpen(false)}
                    >
                      <Icon
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 truncate">{option.label}</span>
                    </a>
                    <ChevronRight
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </div>
                  {option.webmail ? (
                    <a
                      href={option.webmail.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="relative z-10 flex w-full items-center gap-1.5 rounded-t-none rounded-b-lg border-t border-border bg-muted/40 px-11 py-2 text-xs font-medium text-muted-foreground transition-colors outline-none hover:bg-accent/55 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      onClick={() => setOpen(false)}
                    >
                      Open in {option.webmail.label}
                      <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                    </a>
                  ) : null}
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
