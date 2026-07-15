"use client";

import dynamic from "next/dynamic";
import { MessageCircle } from "lucide-react";
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
import {
  SIDEBAR_NAV_ICON_CLASS,
  SIDEBAR_NAV_ITEM_CLASS,
} from "./sidebar-nav-classes";

const HostedAuthPanelIsland = dynamic(
  () => import("@/src/components/hosted-onboarding/hosted-auth-panel-island").then((mod) => mod.HostedAuthPanelIsland),
  {
    ssr: false,
    loading: () => <div className="text-sm text-muted-foreground">Loading sign in...</div>,
  },
);

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
              Whatever healthier looks like for you, Murph helps you understand what matters, build habits that fit your life, and follow through.
            </DialogDescription>
          </DialogHeader>
          {authDialogOpen ? (
            <HostedAuthPanelIsland
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
