import { MessageCircle } from "lucide-react";

import { SidebarMenuButton, SidebarMenuItem } from "@/src/components/ui/sidebar";
import { HostedMurphChatAction } from "@/src/components/murph/hosted-murph-contact-action";
import { cn } from "@/src/lib/utils";
import { SIDEBAR_NAV_ICON_CLASS, SIDEBAR_NAV_ITEM_CLASS } from "./sidebar-nav-classes";

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
  const action = await HostedMurphChatAction({
    label: "Chat with Murph",
    button: (
      <SidebarMenuButton size="lg" className={SIDEBAR_NAV_ITEM_CLASS}>
        <MessageCircle className={SIDEBAR_NAV_ICON_CLASS} />
        Chat with Murph
      </SidebarMenuButton>
    ),
  });

  return <SidebarMenuItem>{action}</SidebarMenuItem>;
}
