"use client";

import { MessageCircle } from "lucide-react";
import { useState } from "react";

import { HostedAuthPanel } from "@/src/components/hosted-onboarding/hosted-auth-panel";
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
      <Dialog open={authDialogOpen} onOpenChange={setAuthDialogOpen}>
        <DialogContent className="max-w-md p-6 md:p-7">
          <DialogHeader className="pr-10">
            <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
              Log in or sign up
            </DialogTitle>
            <DialogDescription>
              Discover what actually makes you healthier.
            </DialogDescription>
          </DialogHeader>
          {authDialogOpen ? (
            <HostedAuthPanel
              methods={["phone", "telegram", "email"]}
              requireLaunchConsentOnCompletion
              size="compact"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </SidebarMenuItem>
  );
}
