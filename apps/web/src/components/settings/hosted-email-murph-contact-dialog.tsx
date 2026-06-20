"use client";

import { Check, ChevronRight, Copy, Mail } from "lucide-react";
import { useId, useState, type SVGProps } from "react";

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
      <path fill="#28A8EA" d="M5.5 11h18v10.5a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5V11z" />
      <path fill="#0364B8" d="M5.5 11h18l-9 6.5-9-6.5z" />
      <path fill="#32B1EA" d="M5.5 23l9-6.5 9 6.5h-18z" />
      <rect x="0" y="5.5" width="12.5" height="13" rx="1.75" fill="#0F7FD7" />
      <ellipse cx="6.25" cy="12" rx="3.4" ry="3.95" fill="#fff" />
      <ellipse cx="6.25" cy="12" rx="1.95" ry="2.7" fill="#0F7FD7" />
    </svg>
  );
}

function YahooMailIcon(props: SVGProps<SVGSVGElement>) {
  const id = useId();
  const bgId = `yahoo-bg-${id}`;
  return (
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <defs>
        <linearGradient id={bgId} x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7B68FF" />
          <stop offset="1" stopColor="#5C00CB" />
        </linearGradient>
      </defs>
      <rect width="24" height="24" rx="4.6" fill={`url(#${bgId})`} />
      <rect x="5.04" y="7.49" width="13.92" height="9.02" rx="0.72" fill="#fff" />
      <path d="M6.14 8.59H17.86V9.69L11.99 12.66 6.14 9.69Z" fill="#7759FF" />
    </svg>
  );
}

function ProtonMailIcon(props: SVGProps<SVGSVGElement>) {
  const id = useId();
  const clipId = `proton-clip-${id}`;
  const backId = `proton-back-${id}`;
  const frontId = `proton-front-${id}`;
  const sideId = `proton-side-${id}`;
  return (
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <defs>
        <linearGradient id={backId} x1="12" y1="4.48" x2="12" y2="19.52" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#828AE5" />
          <stop offset="0.47" stopColor="#B5BDF5" />
          <stop offset="1" stopColor="#D6DAFF" />
        </linearGradient>
        <linearGradient id={frontId} x1="9.86" y1="7.78" x2="9.86" y2="19.52" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#747AEB" />
          <stop offset="1" stopColor="#5661BF" />
        </linearGradient>
        <linearGradient id={sideId} x1="19.86" y1="4.48" x2="19.86" y2="19.52" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7F88E6" />
          <stop offset="0.55" stopColor="#BBC4F7" />
          <stop offset="1" stopColor="#D6DAFF" />
        </linearGradient>
        <clipPath id={clipId}>
          <path d="M2 4.98C2 4.54 2.5 4.34 2.84 4.62L10.88 11.22C11.56 11.78 12.44 11.78 13.12 11.22L21.16 4.62C21.5 4.34 22 4.56 22 4.98V18C22 18.84 21.32 19.52 20.48 19.52H3.52C2.68 19.52 2 18.84 2 18V4.98Z" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect x="2" y="4.48" width="20" height="15.04" fill={`url(#${backId})`} />
        <path
          fill={`url(#${frontId})`}
          d="M2 7.78L8.6 12.98C9.18 13.44 10.02 13.46 10.64 13.02L17.72 7.52V19.52H2V7.78Z"
        />
        <path
          fill={`url(#${sideId})`}
          d="M17.72 7.52L21.16 4.62C21.5 4.34 22 4.56 22 4.98V18C22 18.84 21.32 19.52 20.48 19.52H17.72V7.52Z"
        />
      </g>
    </svg>
  );
}

function FastmailIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <path fill="#69B3E7" d="M21.97 5.32A12 12 0 0 1 2.03 18.68L4.09 17.29A9.51 9.51 0 0 0 19.91 6.71Z" />
      <path fill="#0067B9" d="M2.03 18.68A12 12 0 0 1 21.97 5.32L19.91 6.71A9.51 9.51 0 0 0 4.09 17.29Z" />
      <path fill="#FFC107" d="M6.29 8.17L6.29 15.77L12 12Z" />
      <path fill="#333E48" d="M17.66 8.17L17.66 15.47Q17.66 15.77 17.36 15.77L6.29 15.77Z" />
    </svg>
  );
}
