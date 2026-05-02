import { MessageCircle } from "lucide-react";

import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/src/components/ui/sidebar";
import { resolveHostedMurphContactOption } from "@/src/components/murph/hosted-murph-contact-action";
import { cn } from "@/src/lib/utils";
import {
  SIDEBAR_NAV_ICON_CLASS,
  SIDEBAR_NAV_ITEM_CLASS,
} from "./sidebar-nav-classes";
import { SidebarChatWithMurphAuthGate } from "./sidebar-chat-auth-gate";

export function SidebarChatWithMurphFallback() {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="lg"
        className={cn(SIDEBAR_NAV_ITEM_CLASS, "opacity-70")}
        disabled
        aria-busy="true"
      >
        <MessageCircle className={SIDEBAR_NAV_ICON_CLASS} />
        Chat with Murph
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export async function SidebarChatWithMurphAction() {
  const option = await resolveHostedMurphContactOption();

  if (!option) {
    return <SidebarChatWithMurphAuthGate />;
  }

  const opensInNewTab = option.target === "_blank";

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="lg"
        className={SIDEBAR_NAV_ITEM_CLASS}
        render={
          <a
            href={option.href}
            target={option.target}
            rel={option.rel}
            aria-label={`Chat with Murph in ${option.label}${
              opensInNewTab ? " (opens in a new tab)" : ""
            }`}
          >
            <MessageCircle className={SIDEBAR_NAV_ICON_CLASS} />
            Chat with Murph
          </a>
        }
      />
    </SidebarMenuItem>
  );
}
