"use client";

import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Mail,
  MessageCircle,
  Send,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";

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

const HostedAuthPanelIsland = dynamic(
  () =>
    import(
      "@/src/components/hosted-onboarding/hosted-auth-panel-island"
    ).then((mod) => mod.HostedAuthPanelIsland),
  {
    ssr: false,
    loading: () => (
      <div className="text-sm text-[#736a58]">Loading sign in...</div>
    ),
  },
);

const CONTACT_OPTION_ICONS = {
  email: Mail,
  telegram: Send,
  text: MessageCircle,
} as const;

const BUTTON_CLASS =
  "group/try inline-flex items-center gap-1.5 rounded-full border border-[#3a4a1e]/15 bg-[#3a4a1e] px-3 py-1.5 text-[13px] font-medium text-[#f5f0e8] outline-none transition-[background-color,color] duration-150 ease-out hover:bg-[#2d3a16] focus-visible:ring-2 focus-visible:ring-[#5a6e32]/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#fffcf6] active:scale-[0.97]";

type TryItButtonProps = {
  authenticated: boolean;
  label: string;
  options: MurphContactOption[];
  prompt?: string | null;
};

export function TryItButton({
  authenticated,
  label,
  options,
  prompt,
}: TryItButtonProps) {
  if (options.length === 1) {
    return <SingleChannelButton label={label} option={options[0]!} />;
  }

  if (options.length > 1) {
    return (
      <PickChannelButton label={label} options={options} prompt={prompt} />
    );
  }

  return (
    <AuthGateButton authenticated={authenticated} label={label} />
  );
}

function SingleChannelButton({
  label,
  option,
}: {
  label: string;
  option: MurphContactOption;
}) {
  const opensInNewTab = option.target === "_blank";
  return (
    <a
      href={option.href}
      target={option.target}
      rel={option.rel}
      aria-label={`${label} in ${option.label}${
        opensInNewTab ? " (opens in a new tab)" : ""
      }`}
      className={BUTTON_CLASS}
    >
      {label}
      <ArrowIcon />
    </a>
  );
}

function PickChannelButton({
  label,
  options,
  prompt,
}: {
  label: string;
  options: MurphContactOption[];
  prompt?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [copiedKind, setCopiedKind] = useState<MurphContactKind | null>(null);

  const copyOptionValue = async (option: MurphContactOption) => {
    if (!option.copyValue) {
      return;
    }
    try {
      await navigator.clipboard.writeText(option.copyValue);
    } catch {
      return;
    }
    setCopiedKind(option.kind);
    setTimeout(() => {
      setCopiedKind((kind) => (kind === option.kind ? null : kind));
    }, 2000);
  };

  return (
    <>
      <button
        type="button"
        className={BUTTON_CLASS}
        onClick={() => setOpen(true)}
      >
        {label}
        <ArrowIcon />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md p-6 md:p-7">
          <DialogHeader className="pr-10">
            <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
              Send this to Murph
            </DialogTitle>
            <DialogDescription>
              Pick the channel you want Murph to reply on.
            </DialogDescription>
          </DialogHeader>
          {prompt ? (
            <p className="rounded-lg border border-border bg-muted/40 p-3 font-mono text-[12px] leading-[1.55] text-foreground">
              &ldquo;{prompt}&rdquo;
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            {options.map((option) => {
              const Icon = CONTACT_OPTION_ICONS[option.kind];
              const opensInNewTab = option.target === "_blank";
              const copied = copiedKind === option.kind;
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
                      aria-label={`Send via ${option.label}${
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
                    {option.copyValue ? (
                      <button
                        type="button"
                        className="relative z-10 mr-2 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={
                          copied ? "Copied" : `Copy ${option.label} contact info`
                        }
                        title={copied ? "Copied" : `Copy ${option.label}`}
                        onClick={() => void copyOptionValue(option)}
                      >
                        {copied ? (
                          <Check className="size-3.5" aria-hidden="true" />
                        ) : (
                          <Copy className="size-3.5" aria-hidden="true" />
                        )}
                      </button>
                    ) : null}
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

function AuthGateButton({
  authenticated,
  label,
}: {
  authenticated: boolean;
  label: string;
}) {
  const [open, setOpen] = useState(false);

  if (authenticated) {
    return (
      <a
        href="/settings"
        aria-label="Link a contact method to chat with Murph"
        className={BUTTON_CLASS}
      >
        {label}
        <ArrowIcon />
      </a>
    );
  }

  return (
    <>
      <button
        type="button"
        className={BUTTON_CLASS}
        onClick={() => setOpen(true)}
      >
        {label}
        <ArrowIcon />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md p-6 md:p-7">
          <DialogHeader className="pr-10">
            <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
              Log in or sign up
            </DialogTitle>
            <DialogDescription>
              Sign in to send this directly to Murph on your preferred channel.
            </DialogDescription>
          </DialogHeader>
          {open ? (
            <HostedAuthPanelIsland
              methods={["phone", "telegram", "email"]}
              requireLaunchConsentOnCompletion
              size="compact"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ArrowIcon(): ReactNode {
  return (
    <ArrowUpRight
      aria-hidden="true"
      className="size-3 transition-transform duration-150 ease-out group-hover/try:translate-x-px group-hover/try:-translate-y-px"
    />
  );
}
