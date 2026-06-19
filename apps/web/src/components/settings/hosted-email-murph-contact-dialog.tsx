"use client";

import { Check, ChevronRight, Copy, Mail } from "lucide-react";
import { useState, type SVGProps } from "react";

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
 * "Email Murph" contact link. When the member's address belongs to a known
 * webmail provider, clicking opens a chooser between the native mail app
 * (mailto:) and the webmail compose URL. Otherwise it falls through to a
 * plain mailto link.
 */
export function HostedEmailMurphContactDialog(props: {
  murphEmailAddress: string;
  userEmailAddress: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(props.murphEmailAddress);
    } catch {
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
        <DialogContent className="max-w-md p-6 md:p-7">
          <DialogHeader className="pr-10">
            <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
              Email Murph
            </DialogTitle>
            <DialogDescription>Pick where you want to write it.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <ContactRow
              href={mailtoHref}
              icon={<Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              label="Mail app"
              ariaLabel={`Email Murph from your mail app at ${props.murphEmailAddress}`}
              copied={copied}
              copyAriaLabel={copied ? "Copied" : `Copy ${props.murphEmailAddress}`}
              onCopy={() => void copyAddress()}
              onNavigate={() => setOpen(false)}
            />
            <ContactRow
              href={webmail.href}
              icon={<WebmailIcon label={webmail.label} className="size-4 shrink-0" />}
              label={webmail.label}
              ariaLabel={`Email Murph in ${webmail.label} (opens in a new tab)`}
              external
              onNavigate={() => setOpen(false)}
            />
          </div>
        </DialogContent>
      </Dialog>
    </p>
  );
}

function ContactRow(props: {
  ariaLabel: string;
  copied?: boolean;
  copyAriaLabel?: string;
  external?: boolean;
  href: string;
  icon: React.ReactNode;
  label: string;
  onCopy?: () => void;
  onNavigate: () => void;
}) {
  const showCopy = typeof props.onCopy === "function";
  return (
    <div className="relative flex items-center overflow-hidden rounded-lg border border-border bg-card pr-3 transition-colors hover:bg-accent/55">
      <a
        href={props.href}
        target={props.external ? "_blank" : undefined}
        rel={props.external ? "noopener noreferrer" : undefined}
        aria-label={props.ariaLabel}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-foreground outline-none after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
        onClick={props.onNavigate}
      >
        {props.icon}
        <span className="min-w-0 truncate">{props.label}</span>
      </a>
      {showCopy ? (
        <button
          type="button"
          className="relative z-10 mr-2 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={props.copyAriaLabel}
          title={props.copied ? "Copied" : "Copy email address"}
          onClick={props.onCopy}
        >
          {props.copied ? (
            <Check className="size-3.5" aria-hidden="true" />
          ) : (
            <Copy className="size-3.5" aria-hidden="true" />
          )}
        </button>
      ) : null}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </div>
  );
}

export function WebmailIcon({ label, ...props }: SVGProps<SVGSVGElement> & { label: string }) {
  switch (label) {
    case "Gmail":
      return <GmailIcon {...props} />;
    case "Outlook":
      return <OutlookIcon {...props} />;
    case "Yahoo Mail":
      return <YahooMailIcon {...props} />;
    case "Proton Mail":
      return <ProtonMailIcon {...props} />;
    case "Fastmail":
      return <FastmailIcon {...props} />;
    default:
      return <GmailIcon {...props} />;
  }
}

function GmailIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <path
        fill="#EA4335"
        d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"
      />
    </svg>
  );
}

function OutlookIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <path
        fill="#0078D4"
        d="M7.88 12.04q0 .45-.11.87-.1.41-.33.74-.22.33-.58.52-.37.2-.87.2t-.85-.2q-.35-.21-.57-.55-.22-.33-.33-.75-.1-.42-.1-.86t.1-.87q.1-.43.34-.76.22-.34.59-.54.36-.2.87-.2t.86.2q.35.21.57.55.22.34.31.77.1.43.1.88zM24 12v9.38q0 .46-.33.8-.34.32-.8.32H7.13q-.46 0-.8-.33-.32-.33-.32-.8V18H1q-.41 0-.7-.3-.3-.29-.3-.7V7q0-.41.3-.7Q.58 6 1 6h6.5V2.55q0-.44.3-.75.3-.3.75-.3h12.9q.44 0 .75.3.3.3.3.75V10.85l1.24.72h.01q.1.07.18.18.07.12.07.25zm-6-8.25v3h3v-3zm0 4.5v3h3v-3zm0 4.5v1.83l3.05-1.83zm-5.25-9v3h3.75v-3zm0 4.5v3h3.75v-3zm0 4.5v2.07l2.88 1.62 3.37-2.02V12.75zM9 3.75V6h2l.13.01.12.04v-2.3zM5.98 15.98q.9 0 1.6-.3.7-.32 1.2-.86.48-.55.73-1.28.25-.74.25-1.61 0-.83-.25-1.55-.24-.71-.71-1.24t-1.15-.83q-.68-.3-1.55-.3-.92 0-1.64.3-.71.3-1.2.85-.5.54-.75 1.3-.25.74-.25 1.63 0 .85.26 1.56.26.7.74 1.22.48.52 1.17.81.69.3 1.55.3zM7.5 21h12.39L12 16.42V17q0 .41-.3.7-.29.3-.7.3H7.5zm15-.31v-7.16l-5.9 3.54Z"
      />
    </svg>
  );
}

function YahooMailIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <path
        fill="#6001D2"
        d="M19.828 7.474a1.96 1.96 0 1 1 0-3.913 1.96 1.96 0 0 1 0 3.913zM0 7.527h4.8L7.6 14.683l2.835-7.156H15.1l-7.064 16.946H3.243l1.94-4.474L0 7.527z"
      />
    </svg>
  );
}

function ProtonMailIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <rect width="22" height="22" x="1" y="1" rx="5" fill="#6D4AFF" />
      <path
        fill="#fff"
        d="M8 6h4.6c2.4 0 4 1.5 4 3.7 0 2.2-1.6 3.7-4 3.7h-2v4.6H8V6zm2.6 5.3h1.7c1.1 0 1.7-.6 1.7-1.6S13.4 8 12.3 8h-1.7v3.3z"
      />
    </svg>
  );
}

function FastmailIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <rect width="22" height="22" x="1" y="1" rx="5" fill="#0067B9" />
      <path
        fill="#fff"
        d="M7.5 6h9.5v2.6h-6.8v3h5.7v2.6h-5.7V18H7.5z"
      />
    </svg>
  );
}
