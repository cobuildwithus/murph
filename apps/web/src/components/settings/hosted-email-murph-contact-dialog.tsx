"use client";

import { ExternalLink, Mail } from "lucide-react";
import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import {
  buildMurphEmailHref,
  resolveMurphWebmailShortcut,
} from "@/src/lib/murph-contact-routing";

const MURPH_EMAIL_SUBJECT = "Hey Murph";

/**
 * "Email Murph" contact link. When the member's own address belongs to a
 * known webmail provider we cannot tell whether they read mail there or in a
 * native app, so the link opens a chooser; otherwise it is a plain mailto.
 */
export function HostedEmailMurphContactDialog(props: {
  murphEmailAddress: string;
  userEmailAddress: string | null;
}) {
  const [open, setOpen] = useState(false);
  const mailtoHref = buildMurphEmailHref({
    address: props.murphEmailAddress,
    subject: MURPH_EMAIL_SUBJECT,
  });
  const webmail = resolveMurphWebmailShortcut({
    address: props.murphEmailAddress,
    subject: MURPH_EMAIL_SUBJECT,
    userEmailAddress: props.userEmailAddress,
  });
  const linkClassName =
    "font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline";

  if (!webmail) {
    return (
      <p className="text-xs leading-relaxed text-muted-foreground">
        <a
          href={mailtoHref}
          aria-label={`Email Murph at ${props.murphEmailAddress}`}
          className={linkClassName}
        >
          Email Murph
        </a>
      </p>
    );
  }

  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      <button
        type="button"
        aria-label={`Email Murph at ${props.murphEmailAddress}`}
        aria-haspopup="dialog"
        className={linkClassName}
        onClick={() => setOpen(true)}
      >
        Email Murph
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[min(24rem,calc(100vw-2rem))] gap-6 rounded-2xl border border-border/80 bg-popover p-6 text-popover-foreground ring-border sm:max-w-[24rem] md:p-8">
          <DialogHeader className="gap-2 pr-10">
            <DialogTitle className="font-serif text-2xl/8 font-semibold tracking-normal text-popover-foreground">
              Email Murph
            </DialogTitle>
            <DialogDescription className="text-base/7 text-muted-foreground">
              Pick where you want to write it.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <a
              href={mailtoHref}
              aria-label={`Email Murph from your mail app at ${props.murphEmailAddress}`}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setOpen(false)}
            >
              <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              Mail app
            </a>
            <a
              href={webmail.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Email Murph in ${webmail.label} (opens in a new tab)`}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setOpen(false)}
            >
              <ExternalLink className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              {webmail.label}
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </p>
  );
}
