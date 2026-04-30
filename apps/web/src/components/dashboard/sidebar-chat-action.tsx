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
    return <SidebarChatWithMurphFallback />;
  }

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
            aria-label="Chat with Murph"
          >
            <MessageCircle className={SIDEBAR_NAV_ICON_CLASS} />
            Chat with Murph
          </a>
        }
      />
    </SidebarMenuItem>
  );
}
