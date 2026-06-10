"use client";

import {
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Mail,
  MessageCircle,
  Send,
} from "lucide-react";
import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/src/components/ui/sidebar";
import type {
  MurphContactKind,
  MurphContactOption,
} from "@/src/lib/murph-contact-routing";
import {
  SIDEBAR_NAV_ICON_CLASS,
  SIDEBAR_NAV_ITEM_CLASS,
} from "./sidebar-nav-classes";

const CONTACT_OPTION_ICONS = {
  email: Mail,
  telegram: Send,
  text: MessageCircle,
} as const;

export function SidebarChatWithMurphContactDialog({
  options,
}: {
  options: MurphContactOption[];
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
    <SidebarMenuItem>
      <SidebarMenuButton
        size="lg"
        className={SIDEBAR_NAV_ITEM_CLASS}
        aria-label="Chat with Murph"
        onClick={() => setOpen(true)}
      >
        <MessageCircle className={SIDEBAR_NAV_ICON_CLASS} />
        Chat with Murph
      </SidebarMenuButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md p-6 md:p-7">
          <DialogHeader className="pr-10">
            <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
              Chat with Murph
            </DialogTitle>
            <DialogDescription>
              Pick how you want to reach Murph.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {options.map((option) => {
              const Icon = CONTACT_OPTION_ICONS[option.kind];
              const opensInNewTab = option.target === "_blank";
              const copied = copiedKind === option.kind;

              return (
                <div
                  key={option.kind}
                  className="relative rounded-lg border border-border bg-card transition-colors hover:bg-accent"
                >
                  <div className="flex items-center">
                    <a
                      href={option.href}
                      target={option.target}
                      rel={option.rel}
                      aria-label={`Chat with Murph in ${option.label}${
                        opensInNewTab ? " (opens in a new tab)" : ""
                      }`}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-foreground outline-none after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-ring"
                      onClick={() => setOpen(false)}
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="flex min-w-0 flex-col">
                        <span>{option.label}</span>
                        {option.copyValue ? (
                          <span
                            className="truncate text-xs font-normal text-muted-foreground"
                            title={option.copyValue}
                          >
                            {option.copyValue}
                          </span>
                        ) : null}
                      </span>
                    </a>
                    {option.copyValue ? (
                      <button
                        type="button"
                        className="relative z-10 shrink-0 rounded-md p-2 text-muted-foreground/70 transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={
                          copied ? "Copied" : `Copy ${option.label} contact info`
                        }
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
                      className="mr-3 size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </div>
                  {option.webmail ? (
                    <a
                      href={option.webmail.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="relative z-10 flex items-center gap-1.5 px-4 pb-3 pl-11 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setOpen(false)}
                    >
                      Open in {option.webmail.label}
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                  ) : null}
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </SidebarMenuItem>
  );
}
