"use client";

import { MessageCircle } from "lucide-react";

import { MurphContactDialog } from "@/src/components/murph/murph-contact-dialog";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/src/components/ui/sidebar";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";
import {
  SIDEBAR_NAV_ICON_CLASS,
  SIDEBAR_NAV_ITEM_CLASS,
} from "./sidebar-nav-classes";

export function SidebarChatWithMurphContactDialog({
  options,
}: {
  options: MurphContactOption[];
}) {
  return (
    <SidebarMenuItem>
      <MurphContactDialog
        options={options}
        trigger={(open) => (
          <SidebarMenuButton
            size="lg"
            className={SIDEBAR_NAV_ITEM_CLASS}
            aria-label="Chat with Murph"
            onClick={open}
          >
            <MessageCircle className={SIDEBAR_NAV_ICON_CLASS} />
            Chat with Murph
          </SidebarMenuButton>
        )}
      />
    </SidebarMenuItem>
  );
}
