"use client";

import { ChevronRight, ExternalLink, Mail, MessageCircle, Send } from "lucide-react";

import type {
  MurphContactKind,
  MurphContactOption,
} from "@/src/lib/murph-contact-routing";

const CONTACT_OPTION_ICONS: Record<MurphContactKind, typeof MessageCircle> = {
  email: Mail,
  telegram: Send,
  text: MessageCircle,
};

export function MurphContactChannelRows({
  actionLabel,
  onNavigate,
  options,
}: {
  actionLabel: string;
  onNavigate?: () => void;
  options: readonly MurphContactOption[];
}) {
  return (
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
                aria-label={`${actionLabel} in ${option.label}${
                  opensInNewTab ? " (opens in a new tab)" : ""
                }`}
                className={`flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-sm font-medium text-foreground outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring ${
                  hasWebmail
                    ? "rounded-t-lg after:rounded-t-lg"
                    : "rounded-lg after:rounded-lg"
                }`}
                onClick={() => onNavigate?.()}
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
                onClick={() => onNavigate?.()}
              >
                Open in {option.webmail.label}
                <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
              </a>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
