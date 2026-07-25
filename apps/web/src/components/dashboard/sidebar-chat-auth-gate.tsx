"use client";

import { MessageCircle } from "lucide-react";
import { useState } from "react";

import { AuthDialog } from "@/src/components/hosted-onboarding/auth-dialog";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/src/components/ui/sidebar";
import {
  SIDEBAR_NAV_ICON_CLASS,
  SIDEBAR_NAV_ITEM_CLASS,
} from "./sidebar-nav-classes";

export function SidebarChatWithMurphAuthGate() {
  const [authDialogOpen, setAuthDialogOpen] = useState(false);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="lg"
        className={SIDEBAR_NAV_ITEM_CLASS}
        onClick={() => setAuthDialogOpen(true)}
      >
        <MessageCircle className={SIDEBAR_NAV_ICON_CLASS} />
        Chat with Murph
      </SidebarMenuButton>
      <AuthDialog
        open={authDialogOpen}
        onOpenChange={setAuthDialogOpen}
        requireLaunchConsentOnCompletion
      />
    </SidebarMenuItem>
  );
}

export function SidebarChatWithMurphSettingsGate() {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="lg"
        className={SIDEBAR_NAV_ITEM_CLASS}
        render={
          <a href="/settings" aria-label="Link a contact method to chat with Murph">
            <MessageCircle className={SIDEBAR_NAV_ICON_CLASS} />
            Chat with Murph
          </a>
        }
      />
    </SidebarMenuItem>
  );
}
