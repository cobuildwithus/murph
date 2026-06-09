"use client";

import { Mail, MessageCircle, Send } from "lucide-react";
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
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";
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

              return (
                <a
                  key={option.kind}
                  href={option.href}
                  target={option.target}
                  rel={option.rel}
                  aria-label={`Chat with Murph in ${option.label}${
                    opensInNewTab ? " (opens in a new tab)" : ""
                  }`}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  onClick={() => setOpen(false)}
                >
                  <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  {option.label}
                </a>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </SidebarMenuItem>
  );
}
